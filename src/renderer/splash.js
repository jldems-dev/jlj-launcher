const bar = document.getElementById("bar");
const status = document.getElementById("status");
const percent = document.getElementById("percent");

let progress = 0;

const messages = [
  "Starting application...",
  "Loading modules...",
  "Checking updates...",
  "Preparing interface...",
];

let msgIndex = 0;

const interval = setInterval(() => {
  progress += Math.random() * 7;

  if (progress > 100) progress = 100;

  bar.style.width = progress + "%";
  percent.innerText = Math.floor(progress) + "%";

  if (progress > (msgIndex + 1) * 25 && msgIndex < messages.length - 1) {
    msgIndex++;
    status.innerText = messages[msgIndex];
  }

  if (progress === 100) {
    status.innerText = "Ready...";
    clearInterval(interval);
  }
}, 120);