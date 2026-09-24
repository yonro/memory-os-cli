import {
  EXIT_CODE,
  exitCodeForError,
} from '../lib/core.mjs';

import {
  makeHttpRequest,
  handleRestError,
  safeJson,
  sanitizeTerminalText,
} from '../lib/api.mjs';

export async function handleLedger(ctx) {
  const { command, options, flags, token } = ctx;

  if (command === 'ledger-list') {
    let dateFrom = flags.from;
    let dateTo = flags.to;
    if (flags.month) {
      const [y, m] = flags.month.split('-').map(Number);
      const lastDayNum = new Date(Date.UTC(y, m, 0)).getUTCDate();
      if (!dateFrom) dateFrom = `${flags.month}-01`;
      if (!dateTo) dateTo = `${flags.month}-${String(lastDayNum).padStart(2, '0')}`;
    }

    const args = {};
    if (flags.limit !== undefined) {
      const parsed = Number(flags.limit);
      args.limit = Number.isInteger(parsed) ? parsed : flags.limit;
    }
    if (flags.offset !== undefined) {
      const parsed = Number(flags.offset);
      args.offset = Number.isInteger(parsed) ? parsed : flags.offset;
    }
    if (flags.currency) args.currency = String(flags.currency);
    if (dateFrom) args.date_from = String(dateFrom);
    if (dateTo) args.date_to = String(dateTo);
    if (flags.category) args.category = String(flags.category);
    if (flags['min-amount'] !== undefined) {
      const parsed = Number(flags['min-amount']);
      args.min_amount = !isNaN(parsed) ? parsed : flags['min-amount'];
    }
    if (flags['max-amount'] !== undefined) {
      const parsed = Number(flags['max-amount']);
      args.max_amount = !isNaN(parsed) ? parsed : flags['max-amount'];
    }
    if (flags.type) args.transaction_type = String(flags.type);

    try {
      // Dispatches query to XMemo API over HTTPS with Bearer authorization.
      const res = await makeHttpRequest(options.baseUrl, '/v1/skill/operations', 'POST', {
        operation: 'ledger-list',
        arguments: args,
      }, {
        'Authorization': `Bearer ${token}`
      }, options.timeoutMs);

      const data = handleRestError(res, {
        notFoundMessage: 'Ledger transactions not found.',
        context: 'List ledger transactions request',
        options,
      });

      const result = (data && typeof data.result === 'object' && data.result !== null) ? data.result : data;

      if (options.json) {
        console.log(safeJson({
          ok: true,
          ...(data?.operation ? { operation: data.operation } : {}),
          ...result,
          result,
        }));
        process.exit(EXIT_CODE.SUCCESS);
      }

      const transactions = Array.isArray(result.transactions)
        ? result.transactions
        : (Array.isArray(result) ? result : []);

      if (transactions.length === 0) {
        console.log('No ledger transactions found.');
        process.exit(EXIT_CODE.SUCCESS);
      }

      const totalInfo = result.total !== undefined ? ` (total: ${result.total})` : '';
      console.log(`XMemo Ledger Transactions (${transactions.length}${totalInfo}):`);
      transactions.forEach((tx, idx) => {
        const date = tx.transaction_date || tx.date || tx.created_at || '(unknown date)';
        const amount = (tx.amount !== undefined && tx.amount !== null) ? tx.amount : '(unknown)';
        const curr = tx.currency || 'UNKNOWN';
        const type = tx.transaction_type || tx.type || 'expense';
        const cat = tx.category ? ` [${tx.category}]` : '';
        const desc = tx.description || tx.item || tx.note || '';
        console.log(`[${idx + 1}] ${sanitizeTerminalText(date)} | ${type.toUpperCase()} | ${amount} ${curr}${sanitizeTerminalText(cat)}${desc ? ` | ${sanitizeTerminalText(desc)}` : ''}`);
      });
      process.exit(EXIT_CODE.SUCCESS);
    } catch (e) {
      console.error('List ledger transactions failed:', e.message);
      process.exit(exitCodeForError(e));
    }
  }

  if (command === 'ledger-summary') {
    const args = {};
    if (flags.months !== undefined) {
      const parsed = Number(flags.months);
      args.months = Number.isInteger(parsed) ? parsed : flags.months;
    }
    if (flags.currency) args.currency = String(flags.currency);
    if (flags.type) args.transaction_type = String(flags.type);

    try {
      // Dispatches query to XMemo API over HTTPS with Bearer authorization.
      const res = await makeHttpRequest(options.baseUrl, '/v1/skill/operations', 'POST', {
        operation: 'ledger-summary',
        arguments: args,
      }, {
        'Authorization': `Bearer ${token}`
      }, options.timeoutMs);

      const data = handleRestError(res, {
        notFoundMessage: 'Ledger monthly summary not found.',
        context: 'Get ledger monthly summary request',
        options,
      });

      const result = (data && typeof data.result === 'object' && data.result !== null) ? data.result : data;

      if (options.json) {
        console.log(safeJson({
          ok: true,
          ...(data?.operation ? { operation: data.operation } : {}),
          ...result,
          result,
        }));
        process.exit(EXIT_CODE.SUCCESS);
      }

      const summaryList = Array.isArray(result.summary) ? result.summary : [];
      if (summaryList.length === 0 && result.total === undefined && result.count === undefined) {
        console.log('No ledger monthly summary available.');
        process.exit(EXIT_CODE.SUCCESS);
      }

      if (summaryList.length > 0) {
        console.log(`XMemo Ledger Monthly Summary (${summaryList.length} month${summaryList.length === 1 ? '' : 's'}):`);
        summaryList.forEach((item) => {
          const month = item.month || '(unknown month)';
          const curr = item.currency || 'UNKNOWN';
          const expense = item.expense_total !== undefined ? `${item.expense_total} ${curr}` : null;
          const income = item.income_total !== undefined ? `${item.income_total} ${curr}` : null;
          const net = item.net_total !== undefined ? `${item.net_total} ${curr}` : null;
          const count = item.transaction_count !== undefined ? `${item.transaction_count} tx` : '';
          const parts = [];
          if (expense !== null) parts.push(`Expense: ${expense}`);
          if (income !== null) parts.push(`Income: ${income}`);
          if (net !== null) parts.push(`Net: ${net}`);
          if (count) parts.push(count);
          console.log(`- ${month} (${curr}): ${parts.join(' | ')}`);
        });
        process.exit(EXIT_CODE.SUCCESS);
      }

      const month = result.month || '(unknown month)';
      const curr = result.currency || 'UNKNOWN';
      const total = result.total !== undefined ? result.total : 0;
      const count = result.count !== undefined ? result.count : 0;
      console.log(`XMemo ledger summary for ${sanitizeTerminalText(month)}: ${total} ${curr} across ${count} transaction${count === 1 ? '' : 's'}.`);
      process.exit(EXIT_CODE.SUCCESS);
    } catch (e) {
      console.error('Get ledger monthly summary failed:', e.message);
      process.exit(exitCodeForError(e));
    }
  }
}
