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
    const [organization] = await Organization.findOrCreate({
      where: { slug: 'default' },
      defaults: { name: 'Default Organization' },
      transaction
    });

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

export async function initialiseDatabase() {
  await waitForDatabaseConnection();
  await ensureLegacyUsersHaveOrganization();
  await sequelize.sync({ alter: true });

  const [organization] = await Organization.findOrCreate({
    where: { slug: 'default' },
    defaults: { name: 'Default Organization' }
  });

  await runAsOrganization(organization.id, async () => {
    const users = await User.count();
    if (users === 0) {
      const bcrypt = (await import('bcryptjs')).default;
      const hash = await bcrypt.hash('admin123', 10);
      await User.create({
        full_name: 'Admin',
        email: 'admin@example.com',
        password_hash: hash,
        role: 'admin',
        must_change_password: true
      });
      console.log('Seeded admin user admin@example.com / admin123');
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
