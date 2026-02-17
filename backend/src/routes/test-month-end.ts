import { Router, Request, Response } from 'express';
import { authenticateToken, AuthRequest } from '../middleware/auth';
import { resetToTestState } from '../services/test-month-end-data';
import { initiateMonthEnd } from '../services/month-end';
import { db } from '../db';
import { monthEndState, fundMovements, monthlySnapshots } from '../db/schema';
import { eq, and } from 'drizzle-orm';

const router = Router();

// ── HTML Test Page ───────────────────────────────────────────────────────────

router.get('/', (req: Request, res: Response) => {
  const token = (req.query.token as string) || '';
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'");
  res.send(getHtmlPage(token));
});

// ── API Endpoints ────────────────────────────────────────────────────────────

router.post('/reset', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const result = await resetToTestState(req.userId!);
    res.json({ success: true, ...result });
  } catch (error: any) {
    console.error('[TEST] Reset error:', error);
    res.status(500).json({ error: error.message });
  }
});

router.post('/start', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    await initiateMonthEnd(req.userId!, 2026, 1);
    res.json({ success: true, message: 'Month-end initiated for January 2026. Check Slack.' });
  } catch (error: any) {
    console.error('[TEST] Start error:', error);
    res.status(500).json({ error: error.message });
  }
});

router.get('/state', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId!;

    const states = await db
      .select()
      .from(monthEndState)
      .where(eq(monthEndState.userId, userId));

    const movements = await db
      .select()
      .from(fundMovements)
      .where(eq(fundMovements.userId, userId));

    const snapshots = await db
      .select()
      .from(monthlySnapshots)
      .where(and(
        eq(monthlySnapshots.userId, userId),
        eq(monthlySnapshots.year, 2026),
        eq(monthlySnapshots.month, 1),
      ));

    res.json({ monthEndState: states, fundMovements: movements, snapshots });
  } catch (error: any) {
    console.error('[TEST] State error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ── Inline HTML ──────────────────────────────────────────────────────────────

function getHtmlPage(token: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Month-End Test Harness</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 900px; margin: 0 auto; padding: 20px; background: #f5f5f5; color: #333; }
  h1 { margin-bottom: 16px; }
  .warning { background: #fff3cd; border: 1px solid #ffc107; border-radius: 6px; padding: 12px 16px; margin-bottom: 20px; }
  .warning strong { color: #856404; }
  label { display: block; font-weight: 600; margin-bottom: 4px; }
  input[type="text"] { width: 100%; padding: 8px 12px; border: 1px solid #ccc; border-radius: 4px; font-size: 14px; font-family: monospace; margin-bottom: 16px; }
  .buttons { display: flex; gap: 10px; flex-wrap: wrap; margin-bottom: 20px; }
  button { padding: 10px 20px; border: none; border-radius: 6px; font-size: 14px; font-weight: 600; cursor: pointer; color: #fff; }
  button:disabled { opacity: 0.6; cursor: not-allowed; }
  .btn-reset { background: #dc3545; }
  .btn-start { background: #28a745; }
  .btn-state { background: #007bff; }
  #output { background: #1e1e1e; color: #d4d4d4; border-radius: 6px; padding: 16px; min-height: 200px; overflow-x: auto; white-space: pre-wrap; font-family: 'SF Mono', Monaco, Consolas, monospace; font-size: 13px; margin-bottom: 20px; }
  table { width: 100%; border-collapse: collapse; margin-top: 12px; background: #fff; border-radius: 6px; overflow: hidden; }
  th, td { padding: 8px 12px; text-align: left; border-bottom: 1px solid #e9ecef; font-size: 13px; }
  th { background: #f8f9fa; font-weight: 600; }
  .positive { color: #28a745; }
  .negative { color: #dc3545; }
  .zero { color: #6c757d; }
</style>
</head>
<body>
<h1>Month-End Test Harness</h1>

<div class="warning">
  <strong>Warning:</strong> The Reset button will delete all transactions, categories (except Surplus/Excluded),
  fund movements, snapshots, and month-end state for your account. Only use this in a development environment.
</div>

<label for="token">JWT Token</label>
<input type="text" id="token" value="${token}" placeholder="Paste your JWT token here">

<div class="buttons">
  <button class="btn-reset" onclick="doReset()">Reset to Test State</button>
  <button class="btn-start" onclick="doStart()">Start Month-End (Jan 2026)</button>
  <button class="btn-state" onclick="doState()">Check Current State</button>
</div>

<div id="output">Ready. Paste your token and click a button.</div>
<div id="table-area"></div>

<script>
function getToken() {
  return document.getElementById('token').value.trim();
}

function setOutput(text) {
  document.getElementById('output').textContent = typeof text === 'string' ? text : JSON.stringify(text, null, 2);
}

async function apiFetch(method, path) {
  const token = getToken();
  if (!token) { setOutput('Error: No token provided'); return null; }
  setOutput('Loading...');
  document.getElementById('table-area').innerHTML = '';
  try {
    const res = await fetch('/api/test-month-end' + path, {
      method,
      headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Request failed with status ' + res.status);
    return data;
  } catch (err) {
    setOutput('Error: ' + err.message);
    return null;
  }
}

async function doReset() {
  const data = await apiFetch('POST', '/reset');
  if (!data) return;
  setOutput(data);
  if (data.categories) renderTable(data.categories);
}

async function doStart() {
  const data = await apiFetch('POST', '/start');
  if (!data) return;
  setOutput(data);
}

async function doState() {
  const data = await apiFetch('GET', '/state');
  if (!data) return;
  setOutput(data);
}

function renderTable(categories) {
  let html = '<table><thead><tr><th>ID</th><th>Name</th><th>Type</th><th>Allotted</th><th>Spent</th><th>Rollover</th><th>Net Position</th></tr></thead><tbody>';
  for (const c of categories) {
    const cls = c.netPosition > 0.01 ? 'positive' : c.netPosition < -0.01 ? 'negative' : 'zero';
    html += '<tr><td>' + c.id + '</td><td>' + c.name + '</td><td>' + c.type + '</td>'
      + '<td>$' + c.allotted.toFixed(2) + '</td><td>$' + c.spent.toFixed(2) + '</td>'
      + '<td>$' + c.rollover.toFixed(2) + '</td>'
      + '<td class="' + cls + '">$' + c.netPosition.toFixed(2) + '</td></tr>';
  }
  html += '</tbody></table>';
  document.getElementById('table-area').innerHTML = html;
}
</script>
</body>
</html>`;
}

export default router;
