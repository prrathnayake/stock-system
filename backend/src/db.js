import { Sequelize, DataTypes } from 'sequelize';
import { config } from './config.js';

export const sequelize = new Sequelize(config.db.name, config.db.user, config.db.pass, {
  host: config.db.host,
  port: config.db.port,
  dialect: 'mysql',
  logging: false,
  define: { underscored: true }
});

// Models
export const User = sequelize.define('user', {
  id: { type: DataTypes.INTEGER.UNSIGNED, primaryKey: true, autoIncrement: true },
  full_name: { type: DataTypes.STRING, allowNull: false },
  email: { type: DataTypes.STRING(191), unique: true, allowNull: false },
  password_hash: { type: DataTypes.STRING, allowNull: false },
  role: { type: DataTypes.ENUM('tech','inventory','desk','admin'), defaultValue: 'tech' },
  must_change_password: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false }
});

export const Product = sequelize.define('product', {
  id: { type: DataTypes.INTEGER.UNSIGNED, primaryKey: true, autoIncrement: true },
  sku: { type: DataTypes.STRING(64), unique: true, allowNull: false },
  name: { type: DataTypes.STRING, allowNull: false },
  uom: { type: DataTypes.STRING, defaultValue: 'ea' },
  track_serial: { type: DataTypes.BOOLEAN, defaultValue: false },
  reorder_point: { type: DataTypes.INTEGER.UNSIGNED, defaultValue: 0 },
  lead_time_days: { type: DataTypes.INTEGER.UNSIGNED, defaultValue: 0 },
  active: { type: DataTypes.BOOLEAN, defaultValue: true }
});

export const Location = sequelize.define('location', {
  id: { type: DataTypes.INTEGER.UNSIGNED, primaryKey: true, autoIncrement: true },
  site: { type: DataTypes.STRING, allowNull: false },
  room: { type: DataTypes.STRING },
  notes: { type: DataTypes.TEXT }
});

export const Bin = sequelize.define('bin', {
  id: { type: DataTypes.INTEGER.UNSIGNED, primaryKey: true, autoIncrement: true },
  code: { type: DataTypes.STRING, allowNull: false }
});

export const StockLevel = sequelize.define('stock_level', {
  on_hand: { type: DataTypes.INTEGER, defaultValue: 0 },
  reserved: { type: DataTypes.INTEGER, defaultValue: 0 }
});

export const StockMove = sequelize.define('stock_move', {
  qty: { type: DataTypes.INTEGER, allowNull: false },
  reason: { type: DataTypes.ENUM(
    'receive',
    'adjust',
    'pick',
    'return',
    'transfer',
    'reserve',
    'release',
    'receive_po',
    'rma_out',
    'rma_return'
  ), allowNull: false },
  performed_by: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true }
});

export const WorkOrder = sequelize.define('work_order', {
  id: { type: DataTypes.INTEGER.UNSIGNED, primaryKey: true, autoIncrement: true },
  customer_name: { type: DataTypes.STRING, allowNull: false },
  device_info: { type: DataTypes.STRING, allowNull: false },
  device_serial: { type: DataTypes.STRING },
  priority: { type: DataTypes.ENUM('low','normal','high','urgent'), defaultValue: 'normal' },
  status: { type: DataTypes.ENUM('intake','diagnostics','awaiting_approval','approved','in_progress','awaiting_parts','completed','canceled'), defaultValue: 'intake' },
  intake_notes: { type: DataTypes.TEXT },
  diagnostic_findings: { type: DataTypes.TEXT },
  sla_due_at: { type: DataTypes.DATE },
  warranty_expires_at: { type: DataTypes.DATE },
  warranty_provider: { type: DataTypes.STRING }
});

export const WorkOrderPart = sequelize.define('work_order_part', {
  qty_needed: { type: DataTypes.INTEGER.UNSIGNED, defaultValue: 1 },
  qty_reserved: { type: DataTypes.INTEGER.UNSIGNED, defaultValue: 0 },
  qty_picked: { type: DataTypes.INTEGER.UNSIGNED, defaultValue: 0 }
});

export const WorkOrderStatusHistory = sequelize.define('work_order_status_history', {
  from_status: { type: DataTypes.STRING },
  to_status: { type: DataTypes.STRING, allowNull: false },
  note: { type: DataTypes.TEXT },
  performed_by: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true }
});

export const SerialNumber = sequelize.define('serial_number', {
  serial: { type: DataTypes.STRING(191), unique: true, allowNull: false },
  status: { type: DataTypes.ENUM('available','reserved','assigned','returned','faulty'), defaultValue: 'available' },
  metadata: { type: DataTypes.JSON },
  last_seen_at: { type: DataTypes.DATE }
});

export const SerialAssignment = sequelize.define('serial_assignment', {
  status: { type: DataTypes.ENUM('reserved','picked','returned','released','faulty'), defaultValue: 'reserved' },
  reserved_at: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
  picked_at: { type: DataTypes.DATE },
  returned_at: { type: DataTypes.DATE },
  notes: { type: DataTypes.TEXT },
  performed_by: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true }
});

export const Supplier = sequelize.define('supplier', {
  name: { type: DataTypes.STRING, allowNull: false },
  contact_name: { type: DataTypes.STRING },
  contact_email: { type: DataTypes.STRING },
  phone: { type: DataTypes.STRING },
  lead_time_days: { type: DataTypes.INTEGER.UNSIGNED, defaultValue: 0 }
});

export const PurchaseOrder = sequelize.define('purchase_order', {
  reference: { type: DataTypes.STRING(64), unique: true, allowNull: false },
  status: { type: DataTypes.ENUM('draft','ordered','partially_received','received','closed'), defaultValue: 'draft' },
  expected_at: { type: DataTypes.DATE },
  total_cost: { type: DataTypes.DECIMAL(10, 2), defaultValue: 0 }
});

export const PurchaseOrderLine = sequelize.define('purchase_order_line', {
  qty_ordered: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
  qty_received: { type: DataTypes.INTEGER.UNSIGNED, defaultValue: 0 },
  unit_cost: { type: DataTypes.DECIMAL(10, 2), defaultValue: 0 }
});

export const RmaCase = sequelize.define('rma_case', {
  reference: { type: DataTypes.STRING(64), unique: true, allowNull: false },
  status: { type: DataTypes.ENUM('draft','submitted','in_review','credited','closed'), defaultValue: 'draft' },
  reason: { type: DataTypes.STRING },
  notes: { type: DataTypes.TEXT },
  credit_amount: { type: DataTypes.DECIMAL(10, 2), defaultValue: 0 }
});

export const RmaItem = sequelize.define('rma_item', {
  qty: { type: DataTypes.INTEGER.UNSIGNED, defaultValue: 1 },
  disposition: { type: DataTypes.ENUM('pending','approved','rejected'), defaultValue: 'pending' },
  credit_amount: { type: DataTypes.DECIMAL(10, 2), defaultValue: 0 }
});

export const Setting = sequelize.define('setting', {
  key: { type: DataTypes.STRING(128), unique: true, allowNull: false },
  value: { type: DataTypes.TEXT, allowNull: false },
  type: { type: DataTypes.ENUM('string','number','boolean','json'), defaultValue: 'string' }
});

// Relations
Location.hasMany(Bin, { onDelete: 'CASCADE' });
Bin.belongsTo(Location);

Product.belongsToMany(Bin, { through: StockLevel });
Bin.belongsToMany(Product, { through: StockLevel });

Product.hasMany(StockMove);
StockMove.belongsTo(Product);
Bin.hasMany(StockMove, { as: 'fromBin', foreignKey: 'from_bin_id' });
Bin.hasMany(StockMove, { as: 'toBin', foreignKey: 'to_bin_id' });

WorkOrder.hasMany(WorkOrderPart);
WorkOrderPart.belongsTo(WorkOrder);
Product.hasMany(WorkOrderPart);
WorkOrderPart.belongsTo(Product);

User.hasMany(StockMove, { foreignKey: 'performed_by' });
StockMove.belongsTo(User, { as: 'performedBy', foreignKey: 'performed_by' });
WorkOrder.hasMany(StockMove);
StockMove.belongsTo(WorkOrder);
WorkOrderPart.hasMany(StockMove);
StockMove.belongsTo(WorkOrderPart);
StockMove.belongsTo(SerialNumber);
SerialNumber.hasMany(StockMove);

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
