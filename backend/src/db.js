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
  role: { type: DataTypes.ENUM('tech','inventory','desk','admin'), defaultValue: 'tech' }
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
  reason: { type: DataTypes.ENUM('receive','adjust','pick','return','transfer'), allowNull: false }
});

export const WorkOrder = sequelize.define('work_order', {
  id: { type: DataTypes.INTEGER.UNSIGNED, primaryKey: true, autoIncrement: true },
  customer_name: { type: DataTypes.STRING, allowNull: false },
  device_info: { type: DataTypes.STRING, allowNull: false },
  status: { type: DataTypes.ENUM('intake','approved','in_progress','completed','canceled'), defaultValue: 'intake' }
});

export const WorkOrderPart = sequelize.define('work_order_part', {
  qty_needed: { type: DataTypes.INTEGER.UNSIGNED, defaultValue: 1 },
  qty_reserved: { type: DataTypes.INTEGER.UNSIGNED, defaultValue: 0 },
  qty_picked: { type: DataTypes.INTEGER.UNSIGNED, defaultValue: 0 }
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
