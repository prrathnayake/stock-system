import { DataTypes } from 'sequelize';
import { sequelize, Organization, User, Product, Location, Bin, StockLevel } from '../db.js';
import { config } from '../config.js';
import { runAsOrganization } from '../services/requestContext.js';

const normalizeTableName = (value) => {
  if (!value) return '';
  if (typeof value === 'string') return value.toLowerCase();
  if (typeof value === 'object') {
    if (value.tableName) return String(value.tableName).toLowerCase();
    if (value.table_name) return String(value.table_name).toLowerCase();
    if (value.name) return String(value.name).toLowerCase();
  }
  return String(value).toLowerCase();
};

async function waitForDatabaseConnection({ retries = 10, delayMs = 2000 } = {}) {
  let attempt = 0;
  for (; attempt < retries; attempt += 1) {
    try {
      await sequelize.authenticate();
      return;
    } catch (error) {
      const isLastAttempt = attempt + 1 >= retries;
      console.warn(`Database connection failed (attempt ${attempt + 1}/${retries}): ${error.message}`);
      if (isLastAttempt) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}

async function ensureDefaultOrganization(transaction) {
  const defaults = config.bootstrap.organization;
  const organizationDefaults = {
    name: defaults.name,
    legal_name: defaults.legalName,
    contact_email: defaults.contactEmail || null,
    timezone: defaults.timezone,
    abn: defaults.abn || null,
    tax_id: defaults.taxId || null,
    address: defaults.address || null,
    phone: defaults.phone || null,
    website: defaults.website || null,
    default_payment_terms: defaults.defaultPaymentTerms,
    invoice_notes: defaults.invoiceNotes,
    invoice_prefix: defaults.invoicePrefix,
    currency: defaults.currency,
    invoicing_enabled: defaults.invoicingEnabled
  };
  const [organization] = await Organization.findOrCreate({
    where: { slug: 'default' },
    defaults: organizationDefaults,
    transaction
  });

  return organization;
}

async function cleanupDuplicateOrganizationSlugIndexes() {
  const queryInterface = sequelize.getQueryInterface();
  let tables;
  try {
    tables = await queryInterface.showAllTables();
  } catch (error) {
    console.warn(`Unable to list tables while cleaning organization slug indexes: ${error.message}`);
    return;
  }

  const normalizedTables = Array.isArray(tables)
    ? tables.map(normalizeTableName)
    : [];

  if (!normalizedTables.includes('organizations')) {
    return;
  }

  let indexes;
  try {
    indexes = await queryInterface.showIndex('organizations');
  } catch (error) {
    if (error?.original?.code === 'ER_NO_SUCH_TABLE') {
      return;
    }
    throw error;
  }

  const slugIndexes = Array.isArray(indexes)
    ? indexes.filter((index) => {
      if (!index.unique || !Array.isArray(index.fields) || index.fields.length !== 1) {
        return false;
      }

      const field = index.fields[0];
      const fieldName = normalizeTableName(
        field.attribute ?? field.name ?? field.columnName ?? field.column_name
      );
      return fieldName === 'slug';
    })
    : [];

  if (slugIndexes.length <= 1) {
    return;
  }

  const [indexToKeep, ...indexesToDrop] = slugIndexes.sort((a, b) => {
    const nameA = (a.name ?? '').toLowerCase();
    const nameB = (b.name ?? '').toLowerCase();
    return nameA.localeCompare(nameB);
  });

  for (const index of indexesToDrop) {
    if (!index?.name || index.name === indexToKeep?.name) {
      continue;
    }

    try {
      await queryInterface.removeIndex('organizations', index.name);
    } catch (error) {
      console.warn(`Failed to remove duplicate organization slug index ${index.name}: ${error.message}`);
    }
  }
}

async function ensureLegacyProductsHaveOrganization() {
  const queryInterface = sequelize.getQueryInterface();
  const tables = await queryInterface.showAllTables();
  const normalizedTables = Array.isArray(tables)
    ? tables.map(normalizeTableName)
    : [];

  if (!normalizedTables.includes('products')) {
    return;
  }

  let columns;
  try {
    columns = await queryInterface.describeTable('products');
  } catch (error) {
    if (error?.original?.code === 'ER_NO_SUCH_TABLE') {
      return;
    }
    throw error;
  }

  if (columns.organization_id || columns.organizationId) {
    return;
  }

  if (!normalizedTables.includes('organizations')) {
    await Organization.sync();
  }

  const transaction = await sequelize.transaction();
  try {
    const organization = await ensureDefaultOrganization(transaction);

    await queryInterface.addColumn('products', 'organization_id', {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: true,
      references: {
        model: { tableName: 'organizations' },
        key: 'id'
      },
      onUpdate: 'CASCADE',
      onDelete: 'CASCADE'
    }, { transaction });

    await sequelize.query(
      'UPDATE `products` SET `organization_id` = :organizationId WHERE `organization_id` IS NULL OR `organization_id` = 0',
      {
        replacements: { organizationId: organization.id },
        transaction
      }
    );

    await queryInterface.changeColumn('products', 'organization_id', {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: false,
      references: {
        model: { tableName: 'organizations' },
        key: 'id'
      },
      onUpdate: 'CASCADE',
      onDelete: 'CASCADE'
    }, { transaction });

    await transaction.commit();
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
}

async function ensureLegacyUsersHaveOrganization() {
  const queryInterface = sequelize.getQueryInterface();
  const tables = await queryInterface.showAllTables();
  const normalizedTables = Array.isArray(tables)
    ? tables.map(normalizeTableName)
    : [];

  if (!normalizedTables.includes('users')) {
    return;
  }

  let columns;
  try {
    columns = await queryInterface.describeTable('users');
  } catch (error) {
    if (error?.original?.code === 'ER_NO_SUCH_TABLE') {
      return;
    }
    throw error;
  }

  if (columns.organization_id || columns.organizationId) {
    return;
  }

  if (!normalizedTables.includes('organizations')) {
    await Organization.sync();
  }

  const transaction = await sequelize.transaction();
  try {
    const organization = await ensureDefaultOrganization(transaction);

    await queryInterface.addColumn('users', 'organization_id', {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: true,
      references: {
        model: { tableName: 'organizations' },
        key: 'id'
      },
      onUpdate: 'CASCADE',
      onDelete: 'CASCADE'
    }, { transaction });

    await sequelize.query('UPDATE `users` SET `organization_id` = :organizationId', {
      replacements: { organizationId: organization.id },
      transaction
    });

    await queryInterface.changeColumn('users', 'organization_id', {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: false,
      references: {
        model: { tableName: 'organizations' },
        key: 'id'
      },
      onUpdate: 'CASCADE',
      onDelete: 'CASCADE'
    }, { transaction });

    await transaction.commit();
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
}

async function ensureLegacyLocationsHaveOrganization() {
  const queryInterface = sequelize.getQueryInterface();
  const tables = await queryInterface.showAllTables();
  const normalizedTables = Array.isArray(tables)
    ? tables.map(normalizeTableName)
    : [];

  if (!normalizedTables.includes('locations')) {
    return;
  }

  let columns;
  try {
    columns = await queryInterface.describeTable('locations');
  } catch (error) {
    if (error?.original?.code === 'ER_NO_SUCH_TABLE') {
      return;
    }
    throw error;
  }

  if (columns.organization_id || columns.organizationId) {
    return;
  }

  if (!normalizedTables.includes('organizations')) {
    await Organization.sync();
  }

  const transaction = await sequelize.transaction();
  try {
    const organization = await ensureDefaultOrganization(transaction);

    await queryInterface.addColumn('locations', 'organization_id', {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: true,
      references: {
        model: { tableName: 'organizations' },
        key: 'id'
      },
      onUpdate: 'CASCADE',
      onDelete: 'CASCADE'
    }, { transaction });

    await sequelize.query(
      'UPDATE `locations` SET `organization_id` = :organizationId WHERE `organization_id` IS NULL OR `organization_id` = 0',
      {
        replacements: { organizationId: organization.id },
        transaction
      }
    );

    await queryInterface.changeColumn('locations', 'organization_id', {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: false,
      references: {
        model: { tableName: 'organizations' },
        key: 'id'
      },
      onUpdate: 'CASCADE',
      onDelete: 'CASCADE'
    }, { transaction });

    await transaction.commit();
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
}

async function ensureLegacyBinsHaveOrganization() {
  const queryInterface = sequelize.getQueryInterface();
  const tables = await queryInterface.showAllTables();
  const normalizedTables = Array.isArray(tables)
    ? tables.map(normalizeTableName)
    : [];

  if (!normalizedTables.includes('bins')) {
    return;
  }

  let columns;
  try {
    columns = await queryInterface.describeTable('bins');
  } catch (error) {
    if (error?.original?.code === 'ER_NO_SUCH_TABLE') {
      return;
    }
    throw error;
  }

  if (columns.organization_id || columns.organizationId) {
    return;
  }

  if (!normalizedTables.includes('organizations')) {
    await Organization.sync();
  }

  const transaction = await sequelize.transaction();
  try {
    const organization = await ensureDefaultOrganization(transaction);

    await queryInterface.addColumn('bins', 'organization_id', {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: true,
      references: {
        model: { tableName: 'organizations' },
        key: 'id'
      },
      onUpdate: 'CASCADE',
      onDelete: 'CASCADE'
    }, { transaction });

    const hasLocationsTable = normalizedTables.includes('locations');
    let locationColumns;
    if (hasLocationsTable) {
      try {
        locationColumns = await queryInterface.describeTable('locations');
      } catch (error) {
        if (error?.original?.code !== 'ER_NO_SUCH_TABLE') {
          throw error;
        }
      }
    }

    if (locationColumns?.organization_id || locationColumns?.organizationId) {
      await sequelize.query(
        'UPDATE `bins` SET `organization_id` = (SELECT `organization_id` FROM `locations` WHERE `locations`.`id` = `bins`.`location_id`) WHERE (`organization_id` IS NULL OR `organization_id` = 0) AND `location_id` IS NOT NULL',
        { transaction }
      );
    }

    await sequelize.query(
      'UPDATE `bins` SET `organization_id` = :organizationId WHERE `organization_id` IS NULL OR `organization_id` = 0',
      {
        replacements: { organizationId: organization.id },
        transaction
      }
    );

    await queryInterface.changeColumn('bins', 'organization_id', {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: false,
      references: {
        model: { tableName: 'organizations' },
        key: 'id'
      },
      onUpdate: 'CASCADE',
      onDelete: 'CASCADE'
    }, { transaction });

    await transaction.commit();
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
}

async function ensureLegacyStockLevelsHaveOrganization() {
  const queryInterface = sequelize.getQueryInterface();
  const tables = await queryInterface.showAllTables();
  const normalizedTables = Array.isArray(tables)
    ? tables.map(normalizeTableName)
    : [];

  if (!normalizedTables.includes('stock_levels')) {
    return;
  }

  let columns;
  try {
    columns = await queryInterface.describeTable('stock_levels');
  } catch (error) {
    if (error?.original?.code === 'ER_NO_SUCH_TABLE') {
      return;
    }
    throw error;
  }

  if (columns.organization_id || columns.organizationId) {
    return;
  }

  if (!normalizedTables.includes('organizations')) {
    await Organization.sync();
  }

  const transaction = await sequelize.transaction();
  try {
    const organization = await ensureDefaultOrganization(transaction);

    await queryInterface.addColumn('stock_levels', 'organization_id', {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: true,
      references: {
        model: { tableName: 'organizations' },
        key: 'id'
      },
      onUpdate: 'CASCADE',
      onDelete: 'CASCADE'
    }, { transaction });

    let binColumns;
    if (normalizedTables.includes('bins')) {
      try {
        binColumns = await queryInterface.describeTable('bins');
      } catch (error) {
        if (error?.original?.code !== 'ER_NO_SUCH_TABLE') {
          throw error;
        }
      }
    }

    if (binColumns?.organization_id || binColumns?.organizationId) {
      await sequelize.query(
        'UPDATE `stock_levels` AS `sl`\n' +
        'JOIN `bins` AS `b` ON `sl`.`bin_id` = `b`.`id`\n' +
        'SET `sl`.`organization_id` = `b`.`organization_id`\n' +
        'WHERE (`sl`.`organization_id` IS NULL OR `sl`.`organization_id` = 0) AND `sl`.`bin_id` IS NOT NULL',
        { transaction }
      );
    }

    let productColumns;
    if (normalizedTables.includes('products')) {
      try {
        productColumns = await queryInterface.describeTable('products');
      } catch (error) {
        if (error?.original?.code !== 'ER_NO_SUCH_TABLE') {
          throw error;
        }
      }
    }

    if (productColumns?.organization_id || productColumns?.organizationId) {
      await sequelize.query(
        'UPDATE `stock_levels` AS `sl`\n' +
        'JOIN `products` AS `p` ON `sl`.`product_id` = `p`.`id`\n' +
        'SET `sl`.`organization_id` = `p`.`organization_id`\n' +
        'WHERE (`sl`.`organization_id` IS NULL OR `sl`.`organization_id` = 0) AND `sl`.`product_id` IS NOT NULL',
        { transaction }
      );
    }

    await sequelize.query(
      'UPDATE `stock_levels` SET `organization_id` = :organizationId WHERE `organization_id` IS NULL OR `organization_id` = 0',
      {
        replacements: { organizationId: organization.id },
        transaction
      }
    );

    await queryInterface.changeColumn('stock_levels', 'organization_id', {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: false,
      references: {
        model: { tableName: 'organizations' },
        key: 'id'
      },
      onUpdate: 'CASCADE',
      onDelete: 'CASCADE'
    }, { transaction });

    await transaction.commit();
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
}

async function ensureWorkOrdersHaveAssigneeColumn() {
  const queryInterface = sequelize.getQueryInterface();
  let tables;
  try {
    tables = await queryInterface.showAllTables();
  } catch (error) {
    console.warn(`Unable to list tables while ensuring work order assignee column: ${error.message}`);
    return;
  }

  const normalizedTables = Array.isArray(tables)
    ? tables.map(normalizeTableName)
    : [];

  if (!normalizedTables.includes('work_orders')) {
    return;
  }

  let columns;
  try {
    columns = await queryInterface.describeTable('work_orders');
  } catch (error) {
    if (error?.original?.code === 'ER_NO_SUCH_TABLE') {
      return;
    }
    throw error;
  }

  if (columns.assigned_to || columns.assignedTo) {
    return;
  }

  await queryInterface.addColumn('work_orders', 'assigned_to', {
    type: DataTypes.INTEGER.UNSIGNED,
    allowNull: true,
    references: {
      model: { tableName: 'users' },
      key: 'id'
    },
    onUpdate: 'CASCADE',
    onDelete: 'SET NULL'
  });
}

async function ensureUsersHaveLastSeenColumn() {
  const queryInterface = sequelize.getQueryInterface();
  let tables;
  try {
    tables = await queryInterface.showAllTables();
  } catch (error) {
    console.warn(`Unable to list tables while ensuring user last seen column: ${error.message}`);
    return;
  }

  const normalizedTables = Array.isArray(tables)
    ? tables.map(normalizeTableName)
    : [];

  if (!normalizedTables.includes('users')) {
    return;
  }

  let columns;
  try {
    columns = await queryInterface.describeTable('users');
  } catch (error) {
    if (error?.original?.code === 'ER_NO_SUCH_TABLE') {
      return;
    }
    throw error;
  }

  if (columns.last_seen_at || columns.lastSeenAt) {
    return;
  }

  await queryInterface.addColumn('users', 'last_seen_at', {
    type: DataTypes.DATE,
    allowNull: true
  });
}

export async function initialiseDatabase() {
  await waitForDatabaseConnection();
  await ensureLegacyProductsHaveOrganization();
  await ensureLegacyUsersHaveOrganization();
  await ensureLegacyLocationsHaveOrganization();
  await ensureLegacyBinsHaveOrganization();
  await ensureLegacyStockLevelsHaveOrganization();
  await ensureWorkOrdersHaveAssigneeColumn();
  await ensureUsersHaveLastSeenColumn();
  await cleanupDuplicateOrganizationSlugIndexes();
  await sequelize.sync({ alter: true });

  const defaults = config.bootstrap.organization;
  const [organization] = await Organization.findOrCreate({
    where: { slug: 'default' },
    defaults: {
      name: defaults.name,
      legal_name: defaults.legalName,
      contact_email: defaults.contactEmail || null,
      abn: defaults.abn || null,
      tax_id: defaults.taxId || null,
      address: defaults.address || null,
      phone: defaults.phone || null,
      website: defaults.website || null,
      timezone: defaults.timezone,
      default_payment_terms: defaults.defaultPaymentTerms,
      invoice_notes: defaults.invoiceNotes,
      invoice_prefix: defaults.invoicePrefix,
      currency: defaults.currency,
      invoicing_enabled: defaults.invoicingEnabled
    }
  });

    await runAsOrganization(organization.id, async () => {
      const adminDefaults = config.bootstrap.admin;
      const users = await User.count();
      if (users === 0) {
        const bcrypt = (await import('bcryptjs')).default;
        const hash = await bcrypt.hash(adminDefaults.password, 10);
        await User.create({
          full_name: adminDefaults.name || 'Admin',
          email: adminDefaults.email,
          password_hash: hash,
          role: 'admin',
          must_change_password: true,
          ui_variant: 'pro'
        });
        if (config.env !== 'production') {
          console.log(`Seeded admin user ${adminDefaults.email} with password from DEFAULT_ADMIN_PASSWORD.`);
        }
      }

    if (config.env !== 'production') {
      const locs = await Location.count();
      if (locs === 0) {
        const loc = await Location.create({ site: 'Main', room: 'Store' });
        const binA = await Bin.create({ code: 'A-01', locationId: loc.id });
        const binB = await Bin.create({ code: 'B-01', locationId: loc.id });
        const p1 = await Product.create({ sku: 'BATT-IPHONE', name: 'iPhone Battery', reorder_point: 5 });
        const p2 = await Product.create({ sku: 'SCRN-ANDR-6', name: 'Android Screen 6"', reorder_point: 3 });
        await StockLevel.create({ productId: p1.id, binId: binA.id, on_hand: 10, reserved: 0 });
        await StockLevel.create({ productId: p2.id, binId: binB.id, on_hand: 6, reserved: 0 });
        console.log('Seeded demo data');
      }
    }
  });
}
