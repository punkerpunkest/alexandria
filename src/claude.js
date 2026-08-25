// The adapter. The ONLY file that knows Claude Code exists.
// One long-lived process, one schema, many turns, serialised.
import { spawn } from 'node:child_process';

export class Generator {
  constructor({ schema, model = 'claude-haiku-4-5-20251001', systemPrompt }) {
    this.schema = schema;
    this.model = model;
    this.systemPrompt = systemPrompt;
    this.proc = null;
    this.queue = Promise.resolve();
    this.buf = '';
    this.pending = null;
    this.startupMs = null;
    this.sessionId = null;
  }

  start() {
    const t0 = Date.now();
    const args = [
      '-p',
      '--input-format', 'stream-json',
      '--output-format', 'stream-json',
      '--verbose',
      '--model', this.model,
      '--tools', '',                    // no tools: this is a content generator, not an agent
      '--strict-mcp-config',            // inherit no MCP servers
      '--disable-slash-commands',
      '--json-schema', JSON.stringify(this.schema),
    ];
    if (this.systemPrompt) args.push('--system-prompt', this.systemPrompt);
    args.push('--effort', 'low');

    // MEASURED, and the single biggest lever in the spike: with thinking left on,
    // one module took 138s (115s of it before the first token). With it off the same
    // module takes ~15s and costs a quarter as much. A channel-filling call is not a
    // reasoning task, so the thinking budget is pure latency here.
    this.proc = spawn('claude', args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, MAX_THINKING_TOKENS: '0' },
    });
    this.proc.stdout.setEncoding('utf8');
    this.proc.stdout.on('data', (chunk) => this._onData(chunk, t0));
    this.proc.stderr.setEncoding('utf8');
    this.proc.stderr.on('data', (d) => { if (d.trim()) console.error('[claude stderr]', d.trim()); });
    this.proc.on('exit', (code) => {
      console.error(`[claude] process exited with code ${code}`);
      if (this.pending) this.pending.reject(new Error(`claude exited (${code})`));
      this.proc = null;
    });
    return this;
  }

  _onData(chunk, t0) {
    this.buf += chunk;
    let i;
    while ((i = this.buf.indexOf('\n')) >= 0) {
      const line = this.buf.slice(0, i).trim();
      this.buf = this.buf.slice(i + 1);
      if (!line) continue;
      let frame;
      try { frame = JSON.parse(line); } catch { continue; }

      // First system frame means the process is up and authenticated.
      if (frame.type === 'system' && frame.subtype === 'init') {
        if (this.startupMs === null) this.startupMs = Date.now() - t0;
        this.sessionId = frame.session_id;
        this.apiKeySource = frame.apiKeySource;
      }
      if (frame.type === 'rate_limit_event') this.rateLimit = frame.rate_limit_info;

      if (frame.type === 'result' && this.pending) {
        const p = this.pending;
        this.pending = null;
        if (frame.is_error || frame.subtype !== 'success') {
          p.reject(new Error(`turn failed: ${frame.subtype} ${frame.api_error_status ?? ''}`));
        } else {
          p.resolve({
            data: frame.structured_output ?? null,
            raw: frame.result,
            metrics: {
              ttftMs: frame.ttft_ms ?? null,
              durationMs: frame.duration_ms ?? null,
              apiMs: frame.duration_api_ms ?? null,
              costUsd: frame.total_cost_usd ?? null,
              outputTokens: frame.usage?.output_tokens ?? null,
              cacheReadTokens: frame.usage?.cache_read_input_tokens ?? null,
            },
          });
        }
      }
    }
  }

  // Turns are serialised: one process handles one turn at a time.
  turn(text) {
    this.queue = this.queue.then(() => new Promise((resolve, reject) => {
      if (!this.proc) return reject(new Error('generator not running'));
      this.pending = { resolve, reject };
      const msg = { type: 'user', message: { role: 'user', content: [{ type: 'text', text }] } };
      this.proc.stdin.write(JSON.stringify(msg) + '\n');
    }));
    return this.queue;
  }

  stop() { this.proc?.stdin.end(); }
}
