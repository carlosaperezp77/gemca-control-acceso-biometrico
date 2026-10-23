const ExcelJS = require("exceljs");
const { buildWeeklyReport } = require("./attendance");

const NAVY = "FF1F3864";
const LIGHT = "FFEDEDED";
const WARN = "FFFCE4E4";

async function buildWeeklyExcelBuffer(referenceDate = new Date()) {
  const report = buildWeeklyReport(referenceDate);

  const wb = new ExcelJS.Workbook();
  wb.creator = "App Control de Acceso Biometrico - GEMCA";
  wb.created = new Date();

  const summary = wb.addWorksheet("Resumen semanal");
  summary.columns = [
    { header: "Código", key: "employeeNo", width: 12 },
    { header: "Empleado", key: "name", width: 30 },
    { header: "Sede(s) usada(s)", key: "locations", width: 28 },
    { header: "Horas totales semana", key: "totalHours", width: 18 },
    { header: "Accesos no autorizados", key: "unauthorizedCount", width: 20 },
  ];
  summary.getRow(1).eachCell((cell) => {
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: NAVY } };
  });

  report.employees.forEach((emp, i) => {
    const row = summary.addRow({
      employeeNo: emp.employeeNo,
      name: emp.name,
      locations: emp.locationsUsed.join(" / "),
      totalHours: emp.totalHours,
      unauthorizedCount: emp.unauthorizedCount,
    });
    if (i % 2 === 1) {
      row.eachCell((cell) => (cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: LIGHT } }));
    }
    if (emp.unauthorizedCount > 0) {
      row.getCell("unauthorizedCount").fill = { type: "pattern", pattern: "solid", fgColor: { argb: WARN } };
    }
  });

  const detail = wb.addWorksheet("Detalle diario");
  detail.columns = [
    { header: "Código", key: "employeeNo", width: 12 },
    { header: "Empleado", key: "name", width: 28 },
    { header: "Fecha", key: "date", width: 14 },
    { header: "Entrada", key: "in", width: 12 },
    { header: "Salida", key: "out", width: 12 },
    { header: "Horas", key: "hours", width: 10 },
    { header: "Sede(s)", key: "locations", width: 24 },
    { header: "Marcaje incompleto", key: "incompleto", width: 18 },
  ];
  detail.getRow(1).eachCell((cell) => {
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: NAVY } };
  });

  report.employees.forEach((emp) => {
    emp.days.forEach((d) => {
      detail.addRow({
        employeeNo: emp.employeeNo,
        name: emp.name,
        date: d.dateKey,
        in: d.in || "-",
        out: d.out || "-",
        hours: d.hours,
        locations: d.locations.join(" / "),
        incompleto: d.marcajesIncompletos ? "Sí" : "",
      });
    });
  });

  const anomaliesSheet = wb.addWorksheet("Accesos no autorizados");
  anomaliesSheet.columns = [
    { header: "Código", key: "employeeNo", width: 12 },
    { header: "Empleado", key: "employeeName", width: 28 },
    { header: "Sede del acceso", key: "locationName", width: 24 },
    { header: "Fecha y hora", key: "time", width: 24 },
  ];
  anomaliesSheet.getRow(1).eachCell((cell) => {
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: NAVY } };
  });
  report.anomalies.forEach((a) => anomaliesSheet.addRow(a));

  summary.insertRow(1, [`Semana laboral GEMCA (viernes a jueves): ${report.weekLabel}`]);
  summary.mergeCells("A1:E1");
  summary.getRow(1).font = { bold: true, italic: true };

  const buffer = await wb.xlsx.writeBuffer();
  return { buffer, weekLabel: report.weekLabel };
}

module.exports = { buildWeeklyExcelBuffer };
