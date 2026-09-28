import { hasFlag } from './args.js';
import { UsageError } from './errors.js';
import { writeLine } from './io.js';

export class Plan {
  constructor(titleOrOptions = 'Execution Plan') {
    if (typeof titleOrOptions === 'object' && titleOrOptions !== null) {
      this.title = titleOrOptions.title ?? 'Execution Plan';
      this.steps = [];
      for (const step of titleOrOptions.steps ?? []) {
        this.addStep(step);
      }
    } else {
      this.title = titleOrOptions;
      this.steps = [];
    }
  }

  addStep(step) {
    this.steps.push({
      resource: step.resource,
      client: step.client,
      clientLabel: step.clientLabel ?? step.client,
      action: step.action ?? 'install',
      status: step.status ?? 'will_install', // 'will_install' | 'will_update' | 'will_remove' | 'unchanged' | 'skipped'
      description: step.description ?? '',
      command: step.command ?? null,
      commandStr: step.commandStr ?? (step.command ? step.command.join(' ') : null),
      files: step.files ?? [],
      diff: step.diff ?? null,
      backup: step.backup ?? null,
      note: step.note ?? null,
      apply: step.apply ?? (async () => ({}))
    });
  }

  isNoop() {
    if (this.steps.length === 0) return true;
    return this.steps.every((s) => s.status === 'unchanged' || s.status === 'skipped');
  }

  summary() {
    return {
      title: this.title,
      isNoop: this.isNoop(),
      steps: this.steps.map((s) => ({
        resource: s.resource,
        client: s.client,
        clientLabel: s.clientLabel,
        action: s.action,
        status: s.status,
        description: s.description,
        command: s.command,
        commandStr: s.commandStr,
        files: s.files,
        backup: s.backup,
        note: s.note
      }))
    };
  }
}

export function printPlan(plan, io) {
  writeLine(io.stdout, `${plan.title}:`);
  for (const step of plan.steps) {
    const statusLabel =
      step.status === 'will_install' ? '[install]' :
      step.status === 'will_update' ? '[update]' :
      step.status === 'will_remove' ? '[remove]' :
      step.status === 'unchanged' ? '[unchanged]' :
      `[${step.status}]`;

    writeLine(io.stdout, `  • ${statusLabel} ${step.resource.toUpperCase()} for ${step.clientLabel}`);
    if (step.description) {
      writeLine(io.stdout, `      ${step.description}`);
    }
    if (step.commandStr) {
      writeLine(io.stdout, `      Command: ${step.commandStr}`);
    }
    if (step.files && step.files.length > 0) {
      for (const f of step.files) {
        writeLine(io.stdout, `      Target: ${f}`);
      }
    }
    if (step.backup) {
      writeLine(io.stdout, `      Backup: ${step.backup}`);
    }
    if (step.note) {
      writeLine(io.stdout, `      Note: ${step.note}`);
    }
    if (step.diff) {
      writeLine(io.stdout, '      Diff:');
      const lines = step.diff.split('\n');
      for (const line of lines) {
        writeLine(io.stdout, `        ${line}`);
      }
    }
  }
}

export async function executePlan(plan, argsOrOptions = [], maybeIo) {
  let args = [];
  let io = maybeIo;
  let options = {};
  if (Array.isArray(argsOrOptions)) {
    args = argsOrOptions;
    io = maybeIo ?? defaultIo();
  } else if (argsOrOptions && typeof argsOrOptions === 'object') {
    options = argsOrOptions;
    args = options.args ?? [];
    io = options.io ?? maybeIo ?? defaultIo();
  } else {
    io = maybeIo ?? defaultIo();
  }

  const isJson = options.json ?? hasFlag(args, '--json');
  const dryRun = options.dryRun ?? (hasFlag(args, '--dry-run') || hasFlag(args, '--preview'));
  const yes = options.yes ?? (hasFlag(args, '--yes') || hasFlag(args, '-y'));

  if (plan.isNoop()) {
    if (isJson) {
      writeLine(io.stdout, JSON.stringify({
        ok: true,
        noop: true,
        message: 'Nothing to do (all components are up to date).',
        plan: plan.summary(),
        results: []
      }, null, 2));
      return 0;
    }
    writeLine(io.stdout, 'Nothing to do (all components are up to date).');
    return 0;
  }

  if (!isJson) {
    printPlan(plan, io);
  }

  if (dryRun) {
    if (isJson) {
      writeLine(io.stdout, JSON.stringify({
        ok: true,
        dryRun: true,
        plan: plan.summary(),
        results: []
      }, null, 2));
      return 0;
    }
    writeLine(io.stdout, '[dry-run] Plan not executed.');
    return 0;
  }

  if (!yes) {
    if (isJson) {
      writeLine(io.stdout, JSON.stringify({
        ok: false,
        consentRequired: true,
        plan: plan.summary()
      }, null, 2));
      return 0;
    }

    if (io.stdin?.isTTY === false) {
      throw new UsageError('Mutating command requires confirmation; re-run with --yes or --dry-run.');
    }

    writeLine(io.stdout, 'Proceed with above changes? [y/N] ');
    const answer = await new Promise((resolve) => {
      let buffer = '';
      const onData = (chunk) => {
        buffer += String(chunk);
        const nl = buffer.indexOf('\n');
        if (nl !== -1) {
          cleanup();
          resolve(buffer.slice(0, nl).trim().toLowerCase());
        }
      };
      const onEnd = () => {
        cleanup();
        resolve(buffer.trim().toLowerCase());
      };
      function cleanup() {
        io.stdin?.off?.('data', onData);
        io.stdin?.off?.('end', onEnd);
      }
      if (io.stdin && typeof io.stdin.on === 'function') {
        io.stdin.on('data', onData);
        io.stdin.on('end', onEnd);
      } else {
        resolve('no');
      }
    });

    if (answer !== 'y' && answer !== 'yes') {
      writeLine(io.stdout, 'Operation cancelled.');
      return 0;
    }
  }

  const results = [];
  for (const step of plan.steps) {
    if (step.status === 'unchanged' || step.status === 'skipped') {
      results.push({
        resource: step.resource,
        client: step.client,
        status: step.status,
        skipped: true
      });
      continue;
    }

    try {
      const stepResult = await step.apply(io);
      results.push({
        resource: step.resource,
        client: step.client,
        status: step.status,
        ok: true,
        ...stepResult
      });
    } catch (err) {
      if (isJson) {
        writeLine(io.stdout, JSON.stringify({
          ok: false,
          error: err.message,
          failedStep: { resource: step.resource, client: step.client },
          results
        }, null, 2));
        return 1;
      }
      writeLine(io.stderr, `Error in step ${step.resource} (${step.clientLabel}): ${err.message}`);
      return 1;
    }
  }

  if (isJson) {
    writeLine(io.stdout, JSON.stringify({
      ok: true,
      plan: plan.summary(),
      results
    }, null, 2));
    return 0;
  }

  writeLine(io.stdout, '✓ All changes applied successfully.');
  return 0;
}
