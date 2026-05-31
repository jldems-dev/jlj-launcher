let sidebarClockInterval = null;

function formatSidebarClock(now) {
  const time = new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(now);

  const date = new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(now);

  return { time, date };
}

function updateSidebarClock() {
  const timeEl = $("sidebarClockTime");
  const dateEl = $("sidebarClockDate");
  if (!timeEl || !dateEl) return;

  const { time, date } = formatSidebarClock(new Date());
  timeEl.textContent = time;
  dateEl.textContent = date;
}

function initSidebarClock() {
  updateSidebarClock();
  if (sidebarClockInterval) clearInterval(sidebarClockInterval);
  sidebarClockInterval = setInterval(updateSidebarClock, 1000);
}
