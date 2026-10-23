const db = require("./db");

function listEmployees() {
  return db.prepare(`SELECT * FROM employees ORDER BY name`).all();
}

function getEmployee(employeeNo) {
  return db.prepare(`SELECT * FROM employees WHERE employee_no = ?`).get(employeeNo);
}

/**
 * Crea o actualiza un empleado y sus permisos de sede.
 * allowedZonaIndustrial / allowedTienda: boolean
 */
function upsertEmployee({ employeeNo, name, allowedZonaIndustrial, allowedTienda, active = true }) {
  db.prepare(`
    INSERT INTO employees (employee_no, name, allowed_zona_industrial, allowed_tienda, active)
    VALUES (@employeeNo, @name, @allowedZonaIndustrial, @allowedTienda, @active)
    ON CONFLICT(employee_no) DO UPDATE SET
      name = excluded.name,
      allowed_zona_industrial = excluded.allowed_zona_industrial,
      allowed_tienda = excluded.allowed_tienda,
      active = excluded.active
  `).run({
    employeeNo,
    name,
    allowedZonaIndustrial: allowedZonaIndustrial ? 1 : 0,
    allowedTienda: allowedTienda ? 1 : 0,
    active: active ? 1 : 0,
  });
  return getEmployee(employeeNo);
}

/**
 * Si el empleado no esta registrado todavia, se crea automaticamente a
 * partir de lo reportado por el equipo (con acceso permitido solo en la
 * sede desde la que se registro), para no perder el evento. Talento
 * Humano puede luego ajustar sus permisos desde el panel.
 */
function ensureEmployee(employeeNo, employeeName, locationCode) {
  const existing = getEmployee(employeeNo);
  if (existing) return existing;
  return upsertEmployee({
    employeeNo,
    name: employeeName || `Empleado ${employeeNo}`,
    allowedZonaIndustrial: locationCode === "ZONA_INDUSTRIAL",
    allowedTienda: locationCode === "TIENDA",
    active: true,
  });
}

function isAuthorizedAt(employee, locationCode) {
  if (!employee) return false;
  if (locationCode === "ZONA_INDUSTRIAL") return !!employee.allowed_zona_industrial;
  if (locationCode === "TIENDA") return !!employee.allowed_tienda;
  return false;
}

module.exports = { listEmployees, getEmployee, upsertEmployee, ensureEmployee, isAuthorizedAt };
