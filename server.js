const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
const DATA_FILE = path.join(__dirname, 'data', 'data.json');
const RESTAURANTS_FILE = path.join(__dirname, 'public', 'restaurants.json');

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const normalizeEmail = (value = '') => String(value).trim().toLowerCase();
const sanitizeUser = (user = {}) => {
  const { password: _password, ...safe } = user;
  return safe;
};

const readData = () => JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
const readRestaurants = () => JSON.parse(fs.readFileSync(RESTAURANTS_FILE, 'utf8'));
const writeData = (data) => fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));

app.get('/api/restaurants', (req, res) => {
  res.json(readRestaurants());
});

// Get all data
app.get('/api/data', (req, res) => {
  const data = readData();
  res.json({
    ...data,
    users: Array.isArray(data.users) ? data.users.map(sanitizeUser) : []
  });
});

// Create reservation
app.post('/api/reservations', (req, res) => {
  const data = readData();
  const { name, contact, partySize, date, time } = req.body;
  const restaurants = readRestaurants();
  const restaurantId = req.body.restaurantId || 'the-reserve';
  const selectedRestaurant = restaurants.find(restaurant => restaurant.id === restaurantId);

  if (!name || !contact || !partySize || !date || !time)
    return res.status(400).json({ error: 'All fields required' });
  if (!selectedRestaurant)
    return res.status(400).json({ error: 'Please choose a valid restaurant' });

  const requestedPreorder = req.body.preorder || [];
  if (!Array.isArray(requestedPreorder))
    return res.status(400).json({ error: 'Invalid preorder items' });
  const menuItems = Object.values(selectedRestaurant.menu).flat();
  const preorder = [];
  for (const item of requestedPreorder) {
    if (!item || typeof item !== 'object')
      return res.status(400).json({ error: 'Invalid preorder item' });
    const menuItem = menuItems.find(menuItem => menuItem.name === item.name);
    const quantity = Number(item.quantity);
    if (!menuItem || !Number.isInteger(quantity) || quantity < 1 || quantity > 20)
      return res.status(400).json({ error: 'Preorder items must be on this restaurant menu with a quantity from 1 to 20' });
    preorder.push({ name: menuItem.name, price: menuItem.price, quantity });
  }

  const { openTime, closeTime, slotInterval } = data.restaurant;
  const [openH, openM] = openTime.split(':').map(Number);
  const [closeH, closeM] = closeTime.split(':').map(Number);
  const [resH, resM] = time.split(':').map(Number);
  const openMins = openH * 60 + openM;
  const closeMins = closeH * 60 + closeM;
  const resMins = resH * 60 + resM;

  if (resMins < openMins || resMins >= closeMins - slotInterval)
    return res.status(400).json({ error: 'Time outside restaurant hours' });
  if ((resMins - openMins) % slotInterval !== 0)
    return res.status(400).json({ error: 'Invalid time slot' });

  const duration = slotInterval;
  const resEnd = resMins + duration;

  const availableTable = data.tables.find(t => {
    if (t.capacity < partySize) return false;
    const conflict = data.reservations.some(r => {
      const existingRestaurantId = r.restaurantId || 'the-reserve';
      if (existingRestaurantId !== restaurantId) return false;
      if (r.tableId !== t.id || r.date !== date) return false;
      if (r.status === 'rejected' || r.status === 'cancelled') return false;
      const [rH, rM] = r.time.split(':').map(Number);
      const rStart = rH * 60 + rM;
      const rEnd = rStart + duration;
      return resMins < rEnd && resEnd > rStart;
    });
    return !conflict;
  });

  if (!availableTable)
    return res.status(409).json({ error: 'No available tables for that time and party size' });

  const reservation = {
    id: Date.now().toString(),
    name, contact, partySize: Number(partySize), date, time,
    restaurantId,
    restaurantName: selectedRestaurant.name,
    notes: String(req.body.notes || ''),
    preorder,
    tableId: availableTable.id,
    tableName: availableTable.name,
    status: 'pending',
    createdAt: new Date().toISOString()
  };

  data.reservations.push(reservation);
  writeData(data);
  res.status(201).json(reservation);
});

// Get single reservation
app.get('/api/reservations/:id', (req, res) => {
  const data = readData();
  const r = data.reservations.find(r => r.id === req.params.id);
  if (!r) return res.status(404).json({ error: 'Not found' });
  res.json(r);
});

// Cancel reservation
app.put('/api/reservations/:id/cancel', (req, res) => {
  const data = readData();
  const r = data.reservations.find(r => r.id === req.params.id);
  if (!r) return res.status(404).json({ error: 'Not found' });
  if (r.status === 'seated') return res.status(400).json({ error: 'Cannot cancel a seated reservation' });
  r.status = 'cancelled';
  writeData(data);
  res.json(r);
});

// Modify reservation
app.put('/api/reservations/:id', (req, res) => {
  const data = readData();
  const idx = data.reservations.findIndex(r => r.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  const r = data.reservations[idx];
  if (r.status === 'seated' || r.status === 'cancelled')
    return res.status(400).json({ error: 'Cannot modify this reservation' });

  const { name, contact, partySize, date, time } = req.body;
  const { slotInterval, openTime, closeTime } = data.restaurant;
  const [openH, openM] = openTime.split(':').map(Number);
  const [closeH, closeM] = closeTime.split(':').map(Number);
  const [resH, resM] = time.split(':').map(Number);
  const openMins = openH * 60 + openM;
  const closeMins = closeH * 60 + closeM;
  const resMins = resH * 60 + resM;

  if (resMins < openMins || resMins >= closeMins - slotInterval)
    return res.status(400).json({ error: 'Time outside restaurant hours' });

  const resEnd = resMins + slotInterval;
  const availableTable = data.tables.find(t => {
    if (t.capacity < partySize) return false;
    const conflict = data.reservations.some((res, i) => {
      if (i === idx || res.tableId !== t.id || res.date !== date) return false;
      if ((res.restaurantId || 'the-reserve') !== (r.restaurantId || 'the-reserve')) return false;
      if (res.status === 'rejected' || res.status === 'cancelled') return false;
      const [rH, rM] = res.time.split(':').map(Number);
      const rStart = rH * 60 + rM;
      const rEnd = rStart + slotInterval;
      return resMins < rEnd && resEnd > rStart;
    });
    return !conflict;
  });

  if (!availableTable)
    return res.status(409).json({ error: 'No available tables for that time and party size' });

  Object.assign(r, { name, contact, partySize: Number(partySize), date, time, tableId: availableTable.id, tableName: availableTable.name, status: 'pending' });
  writeData(data);
  res.json(r);
});

// Admin: update reservation status
app.put('/api/admin/reservations/:id/status', (req, res) => {
  const { password, status } = req.body || {};
  const data = readData();
  if (password !== data.restaurant.adminPassword)
    return res.status(401).json({ error: 'Unauthorized' });
  const validStatuses = ['approved', 'rejected', 'seated', 'completed', 'cancelled'];
  if (!validStatuses.includes(status))
    return res.status(400).json({ error: 'Invalid reservation status' });
  const r = data.reservations.find(r => r.id === req.params.id);
  if (!r) return res.status(404).json({ error: 'Not found' });
  const allowedTransitions = {
    pending: ['approved', 'rejected', 'cancelled'],
    approved: ['seated', 'cancelled'],
    seated: ['completed']
  };
  if (!(allowedTransitions[r.status] || []).includes(status))
    return res.status(400).json({ error: `Cannot change reservation from ${r.status} to ${status}` });
  r.status = status;
  const table = data.tables.find(t => t.id === r.tableId);
  if (table) table.occupied = data.reservations.some(reservation =>
    reservation.tableId === table.id && reservation.status === 'seated'
  );
  writeData(data);
  res.json(r);
});

app.delete('/api/admin/users/:id', (req, res) => {
  const { password } = req.body || {};
  const data = readData();
  if (password !== data.restaurant.adminPassword)
    return res.status(401).json({ error: 'Unauthorized' });
  const idx = (data.users || []).findIndex(u => u.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'User not found' });
  if (data.users[idx].role === 'admin')
    return res.status(403).json({ error: 'Administrator accounts cannot be deleted' });
  data.users.splice(idx, 1);
  writeData(data);
  res.json({ success: true });
});

// Admin: manage tables
app.post('/api/admin/tables', (req, res) => {
  const { password, name, capacity } = req.body;
  const data = readData();
  if (password !== data.restaurant.adminPassword)
    return res.status(401).json({ error: 'Unauthorized' });
  const table = { id: Date.now(), name, capacity: Number(capacity), occupied: false };
  data.tables.push(table);
  writeData(data);
  res.status(201).json(table);
});

app.put('/api/admin/tables/:id', (req, res) => {
  const { password, name, capacity } = req.body;
  const data = readData();
  if (password !== data.restaurant.adminPassword)
    return res.status(401).json({ error: 'Unauthorized' });
  const table = data.tables.find(t => t.id === Number(req.params.id));
  if (!table) return res.status(404).json({ error: 'Not found' });
  if (name) table.name = name;
  if (capacity) table.capacity = Number(capacity);
  writeData(data);
  res.json(table);
});

// Server date/time
app.get('/api/datetime', (req, res) => {
  const now = new Date();
  res.json({ iso: now.toISOString(), date: now.toDateString(), time: now.toTimeString().split(' ')[0], timestamp: now.getTime() });
});

// Register
app.post('/api/auth/register', (req, res) => {
  const { name, email, phone, password } = req.body;
  if (!name || !email || !password) return res.status(400).json({ error: 'Name, email and password required' });
  const data = readData();
  if (data.users.find(u => u.email === email)) return res.status(409).json({ error: 'Email already registered' });
  const user = { id: Date.now().toString(), name, email, phone: phone || '', role: 'user', createdAt: new Date().toISOString() };
  data.users.push({ ...user, password });
  writeData(data);
  res.status(201).json(user);
});

// Login
app.post('/api/auth/login', (req, res) => {
  const email = normalizeEmail(req.body?.email ?? '');
  const password = String(req.body?.password ?? '');

  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

  const data = readData();
  const users = Array.isArray(data.users) ? data.users : [];
  const configuredAdminEmail = normalizeEmail(data.restaurant?.adminEmail ?? 'admin@thereserve.com');
  const adminAliases = new Set([configuredAdminEmail, 'admin@reserve.com', 'admin@thereserve.com']);
  const adminUser = users.find(u => normalizeEmail(u.email) === configuredAdminEmail && u.password === data.restaurant.adminPassword)
    || users.find(u => normalizeEmail(u.email) === 'admin@reserve.com' && u.password === data.restaurant.adminPassword)
    || users.find(u => normalizeEmail(u.email) === 'admin@thereserve.com' && u.password === data.restaurant.adminPassword);

  if (adminAliases.has(email) && password === data.restaurant.adminPassword) {
    const safeAdmin = sanitizeUser(adminUser || { id: 'admin-1', name: 'Admin', email: configuredAdminEmail, role: 'admin' });
    return res.json({ ...safeAdmin, email: configuredAdminEmail, role: 'admin', _adminToken: password });
  }

  const user = users.find(u => normalizeEmail(u.email) === email && u.password === password);
  if (!user) return res.status(401).json({ error: 'Invalid email or password' });
  res.json({ ...sanitizeUser(user), role: user.role || 'user' });
});

const PORT = Number(process.env.PORT) || 3000;
app.listen(PORT, () => console.log(`HTML version running at http://localhost:${PORT}`));
