// utils/timeWindow.ts
type Period = "today" | "week" | "6m" | "12m";
const TZ = "America/Sao_Paulo";

// utilzinho pra extrair ano/mes/dia no fuso desejado (sem libs)
function getLocalYMD(date = new Date(), tz = TZ) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const y = Number(parts.find(p => p.type === "year")!.value);
  const m = Number(parts.find(p => p.type === "month")!.value);
  const d = Number(parts.find(p => p.type === "day")!.value);
  return { y, m, d };
}

function startOfDayTZ(date = new Date(), tz = TZ) {
  const { y, m, d } = getLocalYMD(date, tz);
  // meia-noite local convertida pra UTC
  return new Date(Date.UTC(y, m - 1, d, 0, 0, 0, 0));
}

function addDays(d: Date, n: number) {
  const x = new Date(d);
  x.setUTCDate(x.getUTCDate() + n);
  return x;
}

function startOfMonthTZ(date = new Date(), tz = TZ) {
  const { y, m } = getLocalYMD(date, tz);
  return new Date(Date.UTC(y, m - 1, 1, 0, 0, 0, 0));
}

function startOfYearTZ(date = new Date(), tz = TZ) {
  const { y } = getLocalYMD(date, tz);
  return new Date(Date.UTC(y, 0, 1, 0, 0, 0, 0));
}

function startOfISOWeekTZ(date = new Date(), tz = TZ) {
  // usa o dia local pra descobrir o deslocamento até segunda-feira
  const local = startOfDayTZ(date, tz);
  // dia da semana em UTC do "local" (0=Dom, 1=Seg...); converte para índice ISO (Seg=1)
  const tmp = new Date(local);
  const dow = tmp.getUTCDay(); // 0..6
  const iso = dow === 0 ? 7 : dow; // 1..7
  const delta = iso - 1; // quantos dias voltar até segunda
  return addDays(local, -delta);
}

export function resolveTimeWindow(period: Period = "6m", tz = TZ) {
  const now = new Date();
  let start: Date, end: Date, bucket: "hour" | "day" | "month", points: number;

  if (period === "today") {
    start = startOfDayTZ(now, tz);
    end = addDays(start, 1);
    bucket = "hour";
    points = 24;
  } else if (period === "week") {
    start = startOfISOWeekTZ(now, tz);
    end = addDays(start, 7);
    bucket = "day";
    points = 7;
  } else if (period === "12m") {
    // últimos 12 meses corridos (janela móvel)
    const thisMonthStart = startOfMonthTZ(now, tz);
    const s = new Date(thisMonthStart);
    s.setUTCMonth(s.getUTCMonth() - 11); // 12 meses contando o mês atual
    start = s;
    end = addDays(startOfMonthTZ(now, tz), 32); // início do próximo mês (safe)
    end.setUTCDate(1);
    bucket = "month";
    points = 12;
  } else {
    // "6m" (padrão) — últimos 6 meses corridos
    const thisMonthStart = startOfMonthTZ(now, tz);
    const s = new Date(thisMonthStart);
    s.setUTCMonth(s.getUTCMonth() - 5); // 6 meses incluindo o mês atual
    start = s;
    end = addDays(startOfMonthTZ(now, tz), 32);
    end.setUTCDate(1);
    bucket = "month";
    points = 6;
  }

  return { start, end, bucket, points, tz };
}
