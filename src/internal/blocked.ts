import './internal.css';

const api = window.slateInternal;
const params = new URLSearchParams(location.search);
const host = params.get('host') ?? 'this site';
const from = params.get('from');

(document.getElementById('host') as HTMLElement).textContent = host.replace(/^www\./, '');
const taskEl = document.getElementById('task') as HTMLElement;
const timeEl = document.getElementById('time') as HTMLElement;
const endBtn = document.getElementById('end') as HTMLButtonElement;

endBtn.addEventListener('click', () => {
  api.stopFocus();
  // once the session is over, the original page is allowed again
  window.setTimeout(() => { if (from) location.replace(from); }, 150);
});

async function tick() {
  const f = await api.getFocus();
  if (!f || f.endsAt <= Date.now()) {
    taskEl.textContent = 'nothing — session over';
    timeEl.textContent = '0:00';
    endBtn.textContent = from ? 'continue' : 'ok';
    return;
  }
  taskEl.textContent = f.task;
  const left = Math.max(0, f.endsAt - Date.now());
  timeEl.textContent = `${Math.floor(left / 60_000)}:${String(Math.floor((left % 60_000) / 1000)).padStart(2, '0')}`;
}
void tick();
window.setInterval(() => void tick(), 1000);
