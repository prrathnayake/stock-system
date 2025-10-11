import { Sequelize, DataTypes } from 'sequelize';
import { config } from './config.js';
import { getOrganizationId } from './services/requestContext.js';

const dialect = config.db.dialect || 'mysql';

export const sequelize = dialect === 'sqlite'
  ? new Sequelize({
    dialect: 'sqlite',
    storage: config.db.storage || ':memory:',
    logging: false,
    define: { underscored: true }
  })
  : new Sequelize(config.db.name, config.db.user, config.db.pass, {
    host: config.db.host,
    port: config.db.port,
    dialect,
    logging: false,
    define: { underscored: true }
  });

function hasOrganizationAttribute(model) {
  return Object.prototype.hasOwnProperty.call(model.getAttributes(), 'organizationId');
}

function ensureOrganizationWhere(options = {}) {
  const organizationId = getOrganizationId();
  if (!organizationId || options?.skipOrganizationScope) return;

  const hasOrgFilter = (where) => (
    where && (
      Object.prototype.hasOwnProperty.call(where, 'organizationId') ||
      Object.prototype.hasOwnProperty.call(where, 'organization_id')
    )
  );

  if (!hasOrgFilter(options.where)) {
    options.where = options.where ? { ...options.where, organizationId } : { organizationId };
  }

  const processInclude = (include) => {
    if (!include) return;
    const model = include.model ?? include;
    if (model && hasOrganizationAttribute(model) && !hasOrgFilter(include.where)) {
      include.where = include.where ? { ...include.where, organizationId } : { organizationId };
    }
    if (Array.isArray(include.include)) {
      include.include.forEach(processInclude);
    }
  };

  if (Array.isArray(options.include)) {
    options.include.forEach(processInclude);
  }
}

function assignOrganization(instance) {
  const organizationId = getOrganizationId();
  if (!organizationId || !instance || instance.organizationId) return;
  instance.organizationId = organizationId;
}

function applyOrganizationScope(model) {
  if (!hasOrganizationAttribute(model)) return;

  model.addHook('beforeValidate', assignOrganization);
  model.addHook('beforeCreate', assignOrganization);
  model.addHook('beforeBulkCreate', instances => instances.forEach(assignOrganization));
  model.addHook('beforeFind', ensureOrganizationWhere);
  model.addHook('beforeCount', ensureOrganizationWhere);
  model.addHook('beforeDestroy', (_instance, options) => {
    if (options) ensureOrganizationWhere(options);
  });
  model.addHook('beforeBulkDestroy', ensureOrganizationWhere);
  model.addHook('beforeUpdate', (_instance, options) => {
    if (options) ensureOrganizationWhere(options);
  });
  model.addHook('beforeBulkUpdate', ensureOrganizationWhere);
}

// Models
export const Organization = sequelize.define('organization', {
  id: { type: DataTypes.INTEGER.UNSIGNED, primaryKey: true, autoIncrement: true },
  name: { type: DataTypes.STRING(191), allowNull: false },
  slug: { type: DataTypes.STRING(64), allowNull: false },
  legal_name: { type: DataTypes.STRING(191), allowNull: true },
  timezone: { type: DataTypes.STRING(64), allowNull: true },
  contact_email: { type: DataTypes.STRING(191), allowNull: true },
  abn: { type: DataTypes.STRING(32), allowNull: true },
  tax_id: { type: DataTypes.STRING(64), allowNull: true },
  address: { type: DataTypes.TEXT, allowNull: true },
  phone: { type: DataTypes.STRING(32), allowNull: true },
  website: { type: DataTypes.STRING(191), allowNull: true },
  logo_url: { type: DataTypes.STRING(512), allowNull: true },
  invoice_prefix: { type: DataTypes.STRING(16), allowNull: true },
  default_payment_terms: { type: DataTypes.STRING(191), allowNull: true },
  invoice_notes: { type: DataTypes.TEXT, allowNull: true },
  currency: { type: DataTypes.STRING(8), allowNull: true },
  invoicing_enabled: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true }
}, {
  indexes: [
    { unique: true, fields: ['slug'], name: 'organizations_slug_unique' }
  ]
});

Organization.addHook('beforeValidate', (org) => {
  if (org.slug) {
    org.slug = org.slug.toLowerCase().trim();
  }
  if (org.name) {
    org.name = org.name.trim();
  }
  if (org.legal_name) {
    org.legal_name = org.legal_name.trim();
  }
  if (org.contact_email) {
    org.contact_email = org.contact_email.trim().toLowerCase();
  }
  if (org.abn) {
    org.abn = org.abn.trim();
  }
  if (org.tax_id) {
    org.tax_id = org.tax_id.trim();
  }
  if (org.address) {
    org.address = org.address.trim();
  }
  if (org.phone) {
    org.phone = org.phone.trim();
  }
  if (org.website) {
    org.website = org.website.trim();
  }
  if (org.logo_url) {
    org.logo_url = org.logo_url.trim();
  }
  if (org.invoice_prefix) {
    org.invoice_prefix = org.invoice_prefix.trim();
  }
  if (org.default_payment_terms) {
    org.default_payment_terms = org.default_payment_terms.trim();
  }
  if (org.invoice_notes) {
    org.invoice_notes = org.invoice_notes.trim();
  }
  if (org.currency) {
    org.currency = org.currency.trim().toUpperCase();
  }
});

export const User = sequelize.define('user', {
  id: { type: DataTypes.INTEGER.UNSIGNED, primaryKey: true, autoIncrement: true },
  organizationId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
  full_name: { type: DataTypes.STRING, allowNull: false },
  email: { type: DataTypes.STRING(191), allowNull: false },
  password_hash: { type: DataTypes.STRING, allowNull: false },
  role: { type: DataTypes.ENUM('admin', 'user'), defaultValue: 'user' },
  must_change_password: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
  ui_variant: { type: DataTypes.ENUM('pro', 'analytics', 'tabular', 'minimal', 'visual'), defaultValue: 'pro' }
}, {
  indexes: [
    { unique: true, fields: ['organization_id', 'email'] }
  ]
});

export const Product = sequelize.define('product', {
  id: { type: DataTypes.INTEGER.UNSIGNED, primaryKey: true, autoIncrement: true },
  organizationId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
  sku: { type: DataTypes.STRING(64), allowNull: false },
  name: { type: DataTypes.STRING, allowNull: false },
  uom: { type: DataTypes.STRING, defaultValue: 'ea' },
  track_serial: { type: DataTypes.BOOLEAN, defaultValue: false },
  reorder_point: { type: DataTypes.INTEGER.UNSIGNED, defaultValue: 0 },
  lead_time_days: { type: DataTypes.INTEGER.UNSIGNED, defaultValue: 0 },
  unit_price: { type: DataTypes.DECIMAL(12, 2), allowNull: false, defaultValue: 0 },
  active: { type: DataTypes.BOOLEAN, defaultValue: true }
}, {
  indexes: [
    { unique: true, fields: ['organization_id', 'sku'] }
  ]
});

export const Location = sequelize.define('location', {
  id: { type: DataTypes.INTEGER.UNSIGNED, primaryKey: true, autoIncrement: true },
  organizationId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
  site: { type: DataTypes.STRING, allowNull: false },
  room: { type: DataTypes.STRING },
  notes: { type: DataTypes.TEXT }
});

export const Bin = sequelize.define('bin', {
  id: { type: DataTypes.INTEGER.UNSIGNED, primaryKey: true, autoIncrement: true },
  organizationId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
  code: { type: DataTypes.STRING, allowNull: false }
}, {
  indexes: [
    { unique: true, fields: ['organization_id', 'code'] }
  ]
});

export const StockLevel = sequelize.define('stock_level', {
  organizationId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
  on_hand: { type: DataTypes.INTEGER, defaultValue: 0 },
  reserved: { type: DataTypes.INTEGER, defaultValue: 0 }
}, {
  indexes: [
    { unique: true, fields: ['organization_id', 'product_id', 'bin_id'] }
  ]
});

export const StockMove = sequelize.define('stock_move', {
  organizationId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
  qty: { type: DataTypes.INTEGER, allowNull: false },
  invoiceId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
  saleId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
  reason: {
    type: DataTypes.ENUM(
      'receive',
      'adjust',
      'pick',
      'return',
      'transfer',
      'reserve',
      'release',
      'receive_po',
      'rma_out',
      'rma_return',
      'invoice_sale'
    ),
    allowNull: false
  },
  performed_by: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true }
});

export const WorkOrder = sequelize.define('work_order', {
  id: { type: DataTypes.INTEGER.UNSIGNED, primaryKey: true, autoIncrement: true },
  organizationId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
  assignedTo: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
  customer_name: { type: DataTypes.STRING, allowNull: false },
  device_info: { type: DataTypes.STRING, allowNull: false },
  device_serial: { type: DataTypes.STRING },
  priority: { type: DataTypes.ENUM('low','normal','high','urgent'), defaultValue: 'normal' },
  status: {
    type: DataTypes.ENUM(
      'intake',
      'diagnostics',
      'awaiting_approval',
      'approved',
      'in_progress',
      'awaiting_parts',
      'completed',
      'canceled'
    ),
    defaultValue: 'intake'
  },
  intake_notes: { type: DataTypes.TEXT },
  diagnostic_findings: { type: DataTypes.TEXT },
  sla_due_at: { type: DataTypes.DATE },
  warranty_expires_at: { type: DataTypes.DATE },
  warranty_provider: { type: DataTypes.STRING }
});

export const WorkOrderPart = sequelize.define('work_order_part', {
  organizationId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
  qty_needed: { type: DataTypes.INTEGER.UNSIGNED, defaultValue: 1 },
  qty_reserved: { type: DataTypes.INTEGER.UNSIGNED, defaultValue: 0 },
  qty_picked: { type: DataTypes.INTEGER.UNSIGNED, defaultValue: 0 }
});

export const WorkOrderStatusHistory = sequelize.define('work_order_status_history', {
  organizationId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
  from_status: { type: DataTypes.STRING },
  to_status: { type: DataTypes.STRING, allowNull: false },
  note: { type: DataTypes.TEXT },
  performed_by: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true }
});

export const SerialNumber = sequelize.define('serial_number', {
  organizationId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
  serial: { type: DataTypes.STRING(191), allowNull: false },
  status: { type: DataTypes.ENUM('available','reserved','assigned','returned','faulty'), defaultValue: 'available' },
  metadata: { type: DataTypes.JSON },
  last_seen_at: { type: DataTypes.DATE }
}, {
  indexes: [
    { unique: true, fields: ['organization_id', 'serial'] }
  ]
});

export const SerialAssignment = sequelize.define('serial_assignment', {
  organizationId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
  status: { type: DataTypes.ENUM('reserved','picked','returned','released','faulty'), defaultValue: 'reserved' },
  reserved_at: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
  picked_at: { type: DataTypes.DATE },
  returned_at: { type: DataTypes.DATE },
  notes: { type: DataTypes.TEXT },
  performed_by: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true }
});

export const Supplier = sequelize.define('supplier', {
  id: { type: DataTypes.INTEGER.UNSIGNED, primaryKey: true, autoIncrement: true },
  organizationId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
  name: { type: DataTypes.STRING, allowNull: false },
  contact_name: { type: DataTypes.STRING },
  contact_email: { type: DataTypes.STRING },
  phone: { type: DataTypes.STRING },
  lead_time_days: { type: DataTypes.INTEGER.UNSIGNED, defaultValue: 0 }
});

export const PurchaseOrder = sequelize.define('purchase_order', {
  id: { type: DataTypes.INTEGER.UNSIGNED, primaryKey: true, autoIncrement: true },
  organizationId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
  reference: { type: DataTypes.STRING(64), allowNull: false },
  status: { type: DataTypes.ENUM('draft','ordered','partially_received','received','closed'), defaultValue: 'draft' },
  expected_at: { type: DataTypes.DATE },
  total_cost: { type: DataTypes.DECIMAL(10, 2), defaultValue: 0 }
}, {
  indexes: [
    { unique: true, fields: ['organization_id', 'reference'] }
  ]
});

export const PurchaseOrderLine = sequelize.define('purchase_order_line', {
  organizationId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
  qty_ordered: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
  qty_received: { type: DataTypes.INTEGER.UNSIGNED, defaultValue: 0 },
  unit_cost: { type: DataTypes.DECIMAL(10, 2), defaultValue: 0 }
});

export const RmaCase = sequelize.define('rma_case', {
  id: { type: DataTypes.INTEGER.UNSIGNED, primaryKey: true, autoIncrement: true },
  organizationId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
  reference: { type: DataTypes.STRING(64), allowNull: false },
  status: { type: DataTypes.ENUM('draft','submitted','in_review','credited','closed'), defaultValue: 'draft' },
  reason: { type: DataTypes.STRING },
  notes: { type: DataTypes.TEXT },
  credit_amount: { type: DataTypes.DECIMAL(10, 2), defaultValue: 0 }
}, {
  indexes: [
    { unique: true, fields: ['organization_id', 'reference'] }
  ]
});

export const RmaItem = sequelize.define('rma_item', {
  organizationId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
  qty: { type: DataTypes.INTEGER.UNSIGNED, defaultValue: 1 },
  disposition: { type: DataTypes.ENUM('pending','approved','rejected'), defaultValue: 'pending' },
  credit_amount: { type: DataTypes.DECIMAL(10, 2), defaultValue: 0 }
});

export const Setting = sequelize.define('setting', {
  id: { type: DataTypes.INTEGER.UNSIGNED, primaryKey: true, autoIncrement: true },
  organizationId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
  key: { type: DataTypes.STRING(128), allowNull: false },
  value: { type: DataTypes.TEXT, allowNull: false },
  type: { type: DataTypes.ENUM('string','number','boolean','json'), defaultValue: 'string' }
}, {
  indexes: [
    { unique: true, fields: ['organization_id', 'key'] }
  ]
});

export const Invoice = sequelize.define('invoice', {
  id: { type: DataTypes.INTEGER.UNSIGNED, primaryKey: true, autoIncrement: true },
  organizationId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
  invoice_number: { type: DataTypes.STRING(64), allowNull: false },
  status: {
    type: DataTypes.ENUM('draft', 'issued', 'payment_processing', 'paid', 'void'),
    defaultValue: 'draft'
  },
  issue_date: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  due_date: { type: DataTypes.DATE },
  reference: { type: DataTypes.STRING(128) },
  customer_name: { type: DataTypes.STRING(191), allowNull: false },
  customer_email: { type: DataTypes.STRING(191) },
  customer_address: { type: DataTypes.TEXT },
  customer_abn: { type: DataTypes.STRING(32) },
  supplier_name: { type: DataTypes.STRING(191) },
  supplier_abn: { type: DataTypes.STRING(32) },
  supplier_address: { type: DataTypes.TEXT },
  payment_terms: { type: DataTypes.STRING(191) },
  currency: { type: DataTypes.STRING(8), defaultValue: 'AUD' },
  notes: { type: DataTypes.TEXT },
  subtotal: { type: DataTypes.DECIMAL(12, 2), defaultValue: 0 },
  gst_total: { type: DataTypes.DECIMAL(12, 2), defaultValue: 0 },
  total: { type: DataTypes.DECIMAL(12, 2), defaultValue: 0 },
  balance_due: { type: DataTypes.DECIMAL(12, 2), defaultValue: 0 },
  created_by: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
  updated_by: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true }
}, {
  indexes: [
    { unique: true, fields: ['organization_id', 'invoice_number'] }
  ]
});

export const InvoiceLine = sequelize.define('invoice_line', {
  organizationId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
  invoiceId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
  productId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
  binId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
  description: { type: DataTypes.STRING(255), allowNull: false },
  quantity: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
  unit_price: { type: DataTypes.DECIMAL(12, 2), allowNull: false },
  gst_rate: { type: DataTypes.DECIMAL(5, 4), allowNull: false, defaultValue: 0.1 },
  line_subtotal: { type: DataTypes.DECIMAL(12, 2), defaultValue: 0 },
  line_gst: { type: DataTypes.DECIMAL(12, 2), defaultValue: 0 },
  line_total: { type: DataTypes.DECIMAL(12, 2), defaultValue: 0 }
});

export const InvoicePayment = sequelize.define('invoice_payment', {
  organizationId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
  invoiceId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
  recorded_by: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
  amount: { type: DataTypes.DECIMAL(12, 2), allowNull: false },
  method: { type: DataTypes.STRING(64) },
  reference: { type: DataTypes.STRING(128) },
  paid_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  notes: { type: DataTypes.TEXT }
});

export const Customer = sequelize.define('customer', {
  id: { type: DataTypes.INTEGER.UNSIGNED, primaryKey: true, autoIncrement: true },
  organizationId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
  name: { type: DataTypes.STRING(191), allowNull: false },
  email: { type: DataTypes.STRING(191) },
  phone: { type: DataTypes.STRING(64) },
  company: { type: DataTypes.STRING(191) },
  address: { type: DataTypes.TEXT },
  notes: { type: DataTypes.TEXT }
}, {
  indexes: [
    { fields: ['organization_id', 'name'] },
    { fields: ['organization_id', 'email'] }
  ]
});

export const Sale = sequelize.define('sale', {
  id: { type: DataTypes.INTEGER.UNSIGNED, primaryKey: true, autoIncrement: true },
  organizationId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
  customerId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
  status: {
    type: DataTypes.ENUM('reserved', 'backorder', 'complete', 'canceled'),
    defaultValue: 'reserved'
  },
  reference: { type: DataTypes.STRING(64) },
  notes: { type: DataTypes.TEXT },
  reserved_at: { type: DataTypes.DATE },
  completed_at: { type: DataTypes.DATE },
  backordered_at: { type: DataTypes.DATE },
  created_by: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
  completed_by: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true }
});

export const SaleItem = sequelize.define('sale_item', {
  organizationId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
  saleId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
  productId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
  quantity: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
  qty_reserved: { type: DataTypes.INTEGER.UNSIGNED, defaultValue: 0 },
  qty_shipped: { type: DataTypes.INTEGER.UNSIGNED, defaultValue: 0 },
  unit_price: { type: DataTypes.DECIMAL(12, 2), allowNull: true }
});

export const UserActivity = sequelize.define('user_activity', {
  organizationId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
  userId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
  action: { type: DataTypes.STRING(128), allowNull: false },
  entity_type: { type: DataTypes.STRING(64) },
  entity_id: { type: DataTypes.STRING(64) },
  description: { type: DataTypes.TEXT },
  metadata: { type: DataTypes.JSON }
});

applyOrganizationScope(User);
applyOrganizationScope(Product);
applyOrganizationScope(Location);
applyOrganizationScope(Bin);
applyOrganizationScope(StockLevel);
applyOrganizationScope(StockMove);
applyOrganizationScope(WorkOrder);
applyOrganizationScope(WorkOrderPart);
applyOrganizationScope(WorkOrderStatusHistory);
applyOrganizationScope(SerialNumber);
applyOrganizationScope(SerialAssignment);
applyOrganizationScope(Supplier);
applyOrganizationScope(PurchaseOrder);
applyOrganizationScope(PurchaseOrderLine);
applyOrganizationScope(RmaCase);
applyOrganizationScope(RmaItem);
applyOrganizationScope(Setting);
applyOrganizationScope(Invoice);
applyOrganizationScope(InvoiceLine);
applyOrganizationScope(InvoicePayment);
applyOrganizationScope(Customer);
applyOrganizationScope(Sale);
applyOrganizationScope(SaleItem);
applyOrganizationScope(UserActivity);

// Relations
Organization.hasMany(User, { foreignKey: { allowNull: false } });
User.belongsTo(Organization);

Organization.hasMany(Product, { foreignKey: { allowNull: false } });
Product.belongsTo(Organization);

Organization.hasMany(Location, { foreignKey: { allowNull: false } });
Location.belongsTo(Organization);

Organization.hasMany(Bin, { foreignKey: { allowNull: false } });
Bin.belongsTo(Organization);

Organization.hasMany(StockLevel, { foreignKey: { allowNull: false } });
StockLevel.belongsTo(Organization);

Organization.hasMany(StockMove, { foreignKey: { allowNull: false } });
StockMove.belongsTo(Organization);

Organization.hasMany(WorkOrder, { foreignKey: { allowNull: false } });
WorkOrder.belongsTo(Organization);

Organization.hasMany(WorkOrderPart, { foreignKey: { allowNull: false } });
WorkOrderPart.belongsTo(Organization);

Organization.hasMany(WorkOrderStatusHistory, { foreignKey: { allowNull: false } });
WorkOrderStatusHistory.belongsTo(Organization);

Organization.hasMany(SerialNumber, { foreignKey: { allowNull: false } });
SerialNumber.belongsTo(Organization);

Organization.hasMany(SerialAssignment, { foreignKey: { allowNull: false } });
SerialAssignment.belongsTo(Organization);

Organization.hasMany(Supplier, { foreignKey: { allowNull: false } });
Supplier.belongsTo(Organization);

Organization.hasMany(PurchaseOrder, { foreignKey: { allowNull: false } });
PurchaseOrder.belongsTo(Organization);

Organization.hasMany(PurchaseOrderLine, { foreignKey: { allowNull: false } });
PurchaseOrderLine.belongsTo(Organization);

Organization.hasMany(RmaCase, { foreignKey: { allowNull: false } });
RmaCase.belongsTo(Organization);

Organization.hasMany(RmaItem, { foreignKey: { allowNull: false } });
RmaItem.belongsTo(Organization);

Organization.hasMany(Setting, { foreignKey: { allowNull: false } });
Setting.belongsTo(Organization);
Organization.hasMany(Invoice, { foreignKey: { name: 'organizationId', allowNull: false } });
Invoice.belongsTo(Organization, { foreignKey: { name: 'organizationId', allowNull: false } });
Organization.hasMany(InvoiceLine, { foreignKey: { name: 'organizationId', allowNull: false } });
InvoiceLine.belongsTo(Organization, { foreignKey: { name: 'organizationId', allowNull: false } });
Organization.hasMany(InvoicePayment, { foreignKey: { name: 'organizationId', allowNull: false } });
InvoicePayment.belongsTo(Organization, { foreignKey: { name: 'organizationId', allowNull: false } });
Organization.hasMany(Customer, { foreignKey: { allowNull: false } });
Customer.belongsTo(Organization, { foreignKey: { allowNull: false } });
Organization.hasMany(Sale, { foreignKey: { allowNull: false } });
Sale.belongsTo(Organization, { foreignKey: { allowNull: false } });
Organization.hasMany(SaleItem, { foreignKey: { allowNull: false } });
SaleItem.belongsTo(Organization, { foreignKey: { allowNull: false } });
Organization.hasMany(UserActivity, { foreignKey: { name: 'organizationId', allowNull: false } });
UserActivity.belongsTo(Organization, { foreignKey: { name: 'organizationId', allowNull: false } });

Location.hasMany(Bin, { onDelete: 'CASCADE' });
Bin.belongsTo(Location);

Product.belongsToMany(Bin, { through: StockLevel });
Bin.belongsToMany(Product, { through: StockLevel });
StockLevel.belongsTo(Product, { foreignKey: { allowNull: false } });
StockLevel.belongsTo(Bin, { foreignKey: { allowNull: false } });
Product.hasMany(StockLevel, { foreignKey: { allowNull: false } });
Bin.hasMany(StockLevel, { foreignKey: { allowNull: false } });

Product.hasMany(StockMove);
StockMove.belongsTo(Product);
Bin.hasMany(StockMove, { as: 'fromBin', foreignKey: { name: 'from_bin_id', allowNull: true } });
Bin.hasMany(StockMove, { as: 'toBin', foreignKey: { name: 'to_bin_id', allowNull: true } });
StockMove.belongsTo(Bin, { as: 'fromBin', foreignKey: { name: 'from_bin_id', allowNull: true } });
StockMove.belongsTo(Bin, { as: 'toBin', foreignKey: { name: 'to_bin_id', allowNull: true } });

WorkOrder.hasMany(WorkOrderPart);
WorkOrderPart.belongsTo(WorkOrder);
Product.hasMany(WorkOrderPart);
WorkOrderPart.belongsTo(Product);
User.hasMany(WorkOrder, { as: 'assignedWorkOrders', foreignKey: 'assigned_to' });
WorkOrder.belongsTo(User, { as: 'assignee', foreignKey: 'assigned_to' });

User.hasMany(StockMove, { foreignKey: 'performed_by' });
StockMove.belongsTo(User, { as: 'performedBy', foreignKey: 'performed_by' });
WorkOrder.hasMany(StockMove);
StockMove.belongsTo(WorkOrder);
WorkOrderPart.hasMany(StockMove);
StockMove.belongsTo(WorkOrderPart);
StockMove.belongsTo(SerialNumber);
SerialNumber.hasMany(StockMove);
Invoice.hasMany(StockMove, { foreignKey: { name: 'invoiceId', allowNull: true } });
StockMove.belongsTo(Invoice, { foreignKey: { name: 'invoiceId', allowNull: true } });

WorkOrder.hasMany(WorkOrderStatusHistory);
WorkOrderStatusHistory.belongsTo(WorkOrder);
User.hasMany(WorkOrderStatusHistory, { foreignKey: 'performed_by' });
WorkOrderStatusHistory.belongsTo(User, { as: 'performedBy', foreignKey: 'performed_by' });

Product.hasMany(SerialNumber);
SerialNumber.belongsTo(Product);
Bin.hasMany(SerialNumber);
SerialNumber.belongsTo(Bin);
WorkOrder.hasMany(SerialNumber);
SerialNumber.belongsTo(WorkOrder);

SerialNumber.hasMany(SerialAssignment);
SerialAssignment.belongsTo(SerialNumber);
WorkOrderPart.hasMany(SerialAssignment);
SerialAssignment.belongsTo(WorkOrderPart);
WorkOrder.hasMany(SerialAssignment);
SerialAssignment.belongsTo(WorkOrder);
User.hasMany(SerialAssignment, { foreignKey: 'performed_by' });
SerialAssignment.belongsTo(User, { as: 'performedBy', foreignKey: 'performed_by' });

Supplier.hasMany(PurchaseOrder);
PurchaseOrder.belongsTo(Supplier);
PurchaseOrder.hasMany(PurchaseOrderLine, { as: 'lines' });
PurchaseOrderLine.belongsTo(PurchaseOrder);
Product.hasMany(PurchaseOrderLine);
PurchaseOrderLine.belongsTo(Product);

Supplier.hasMany(RmaCase);
RmaCase.belongsTo(Supplier);
WorkOrder.hasMany(RmaCase);
RmaCase.belongsTo(WorkOrder);
RmaCase.hasMany(RmaItem, { as: 'items' });
RmaItem.belongsTo(RmaCase);
Product.hasMany(RmaItem);
RmaItem.belongsTo(Product);
SerialNumber.hasMany(RmaItem);
RmaItem.belongsTo(SerialNumber);

Invoice.hasMany(InvoiceLine, { as: 'lines', foreignKey: { name: 'invoiceId', allowNull: false } });
InvoiceLine.belongsTo(Invoice, { foreignKey: { name: 'invoiceId', allowNull: false } });
InvoiceLine.belongsTo(Product, { foreignKey: { name: 'productId', allowNull: false } });
Product.hasMany(InvoiceLine, { foreignKey: { name: 'productId', allowNull: false } });
Customer.hasMany(Sale, { foreignKey: { allowNull: false } });
Sale.belongsTo(Customer, { foreignKey: { allowNull: false } });
Sale.hasMany(SaleItem, { as: 'items', foreignKey: { name: 'saleId', allowNull: false } });
SaleItem.belongsTo(Sale, { foreignKey: { name: 'saleId', allowNull: false } });
Product.hasMany(SaleItem, { foreignKey: { name: 'productId', allowNull: false } });
SaleItem.belongsTo(Product, { foreignKey: { name: 'productId', allowNull: false } });
User.hasMany(Sale, { foreignKey: { name: 'created_by', allowNull: true }, as: 'salesCreated' });
Sale.belongsTo(User, { foreignKey: { name: 'created_by', allowNull: true }, as: 'createdBy' });
User.hasMany(Sale, { foreignKey: { name: 'completed_by', allowNull: true }, as: 'salesCompleted' });
Sale.belongsTo(User, { foreignKey: { name: 'completed_by', allowNull: true }, as: 'completedBy' });
InvoiceLine.belongsTo(Bin, { as: 'bin', foreignKey: { name: 'binId', allowNull: true } });
Bin.hasMany(InvoiceLine, { foreignKey: { name: 'binId', allowNull: true } });

Invoice.hasMany(InvoicePayment, { as: 'payments', foreignKey: { name: 'invoiceId', allowNull: false } });
InvoicePayment.belongsTo(Invoice, { foreignKey: { name: 'invoiceId', allowNull: false } });
User.hasMany(Invoice, { foreignKey: { name: 'created_by', allowNull: true }, as: 'createdInvoices' });
Invoice.belongsTo(User, { foreignKey: { name: 'created_by', allowNull: true }, as: 'createdBy' });
User.hasMany(Invoice, { foreignKey: { name: 'updated_by', allowNull: true }, as: 'updatedInvoices' });
Invoice.belongsTo(User, { foreignKey: { name: 'updated_by', allowNull: true }, as: 'updatedBy' });
User.hasMany(InvoicePayment, { foreignKey: { name: 'recorded_by', allowNull: true }, as: 'recordedPayments' });
InvoicePayment.belongsTo(User, { foreignKey: { name: 'recorded_by', allowNull: true }, as: 'recordedBy' });
Sale.hasMany(StockMove, { foreignKey: { name: 'saleId', allowNull: true } });
StockMove.belongsTo(Sale, { foreignKey: { name: 'saleId', allowNull: true } });
User.hasMany(UserActivity, { foreignKey: { name: 'userId', allowNull: true } });
UserActivity.belongsTo(User, { foreignKey: { name: 'userId', allowNull: true } });

// Utility
export async function withTransaction(cb) {
  const t = await sequelize.transaction();
  try {
    const result = await cb(t);
    await t.commit();
    return result;
  } catch (err) {
    await t.rollback();
    throw err;
  }
}
