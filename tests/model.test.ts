import { describe, expect, it } from 'vitest'
import { accountBalance, canonicalTransaction, createSeed, decodeState, money, safeSum, uid, type Transaction } from '../src/lib/model'
import { amountCaretPosition, formatAmountInput, parseAmount, today } from '../src/lib/format'
const seed = () => createSeed()
function transaction(patch: Partial<Transaction> = {}): Transaction {
  return { id: uid(), accountId: seed().accounts[0].id, categoryId: seed().categories[0].id, type: 'income', amount: 100, date: '2026-11-15', updatedAt: new Date().toISOString(), deletedAt: null, ...patch }
}
describe('financial domain regressions', () => {
  it('removes the old target when a transfer becomes income or expense', () => {
    const state = seed(); const [from, to] = state.accounts
    const transfer = transaction({ type: 'transfer', categoryId: undefined, targetAccountId: to.id })
    const income = canonicalTransaction({ ...transfer, type: 'income', categoryId: state.categories[0].id })
    expect(income.targetAccountId).toBeUndefined()
    expect(accountBalance(from, [income])).toBe(100)
    expect(accountBalance(to, [income])).toBe(0)
    const expense = canonicalTransaction({ ...transfer, type: 'expense', categoryId: state.categories[2].id })
    expect(accountBalance(from, [expense])).toBe(-100)
    expect(accountBalance(to, [expense])).toBe(0)
    expect(accountBalance(from, [transfer]) + accountBalance(to, [transfer])).toBe(0)
  })
  it('clears the old category when converting to a transfer', () => {
    const value = canonicalTransaction(transaction({ type: 'transfer', targetAccountId: seed().accounts[1].id }))
    expect(value.categoryId).toBeUndefined()
    expect(() => decodeState({ ...seed(), transactions: [value] })).not.toThrow()
  })
  it.each([{}, { accounts: 'invalid' }, { ...seed(), accounts: [seed().accounts[0], seed().accounts[0]] }])('rejects incomplete or duplicate backup data', raw => {
    expect(() => decodeState(raw)).toThrow()
  })
  it('rejects missing/deleted parents and incompatible categories', () => {
    const state = seed(); const tx = transaction()
    expect(() => decodeState({ ...state, transactions: [{ ...tx, accountId: uid() }] })).toThrow()
    expect(() => decodeState({ ...state, transactions: [{ ...tx, categoryId: state.categories[2].id }] })).toThrow()
    state.accounts[0].deletedAt = new Date().toISOString()
    expect(() => decodeState({ ...state, transactions: [tx] })).toThrow()
  })
  it.each(['2026-02-30', '0000-01-01', 'invalid'])('rejects invalid transaction date %s', date => {
    expect(() => decodeState({ ...seed(), transactions: [transaction({ date })] })).toThrow()
  })
  it('rejects malformed external transaction shape instead of concealing it', () => {
    expect(() => decodeState({ ...seed(), transactions: [transaction({ targetAccountId: seed().accounts[1].id })] })).toThrow()
  })
  it.each([NaN, Infinity, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])('rejects invalid money %s', amount => {
    expect(() => money(amount, 'Nominal', 1)).toThrow()
  })
  it('supports negative opening balances and checks totals without precision loss', () => {
    expect(money(-500, 'Saldo awal', Number.MIN_SAFE_INTEGER)).toBe(-500)
    expect(safeSum([Number.MAX_SAFE_INTEGER, 1, -1])).toBe(Number.MAX_SAFE_INTEGER)
    expect(() => safeSum([Number.MAX_SAFE_INTEGER, 1])).toThrow()
  })
  it.each(['1.5', '1,50', 'Rp 1x00', 'Infinity', '9007199254740992'])('rejects ambiguous or unsafe amount %s', input => expect(() => parseAmount(input)).toThrow())
  it('parses integer grouping and preserves a negative sign', () => {
    expect(parseAmount('1.234.567')).toBe(1234567)
    expect(parseAmount('1,234,567')).toBe(1234567)
    expect(parseAmount('-100')).toBe(-100)
    expect(today()).toMatch(/^\d{4}-\d\d-\d\d$/)
  })
  it('regroups thousands after every digit of a ten-million amount', () => {
    let previous = ''
    for (const [digit, expected] of [['1', '1'], ['0', '10'], ['0', '100'], ['0', '1.000'], ['0', '10.000'], ['0', '100.000'], ['0', '1.000.000'], ['0', '10.000.000']]) {
      previous = formatAmountInput(previous + digit, { previous, inputType: 'insertText', data: digit })
      expect(previous).toBe(expected)
    }
    expect(parseAmount(previous)).toBe(10000000)
  })
  it.each([
    ['1.234.56', '1.234.567', '123.456'],
    ['1000.000', '1.000.000', '1.000.000'],
    ['.000', '1.000', '0'],
    ['.', '1.000', ''],
  ])('regroups deletion %s without freezing on the old separators', (raw, previous, expected) => {
    expect(formatAmountInput(raw, { previous, inputType: 'deleteContentBackward' })).toBe(expected)
  })
  it('preserves the sign when typing a negative opening balance', () => {
    expect(formatAmountInput('-1.0000', { previous: '-1.000', inputType: 'insertText', data: '0' })).toBe('-10.000')
  })
  it('keeps malformed pasted amounts and manually typed decimals invalid', () => {
    expect(formatAmountInput('1.5', { previous: '1.000', inputType: 'insertFromPaste' })).toBe('1.5')
    expect(formatAmountInput('1.5', { previous: '1.000', inputType: 'insertText', data: '1.5' })).toBe('1.5')
    expect(formatAmountInput('1.', { previous: '1', inputType: 'insertText', data: '.' })).toBe('1.')
    expect(formatAmountInput('1.5', { previous: '1.', inputType: 'insertText', data: '5' })).toBe('1.5')
    expect(formatAmountInput('1.000x', { previous: '1.000', inputType: 'insertText', data: 'x' })).toBe('1.000x')
    expect(() => parseAmount('1.5')).toThrow()
  })
  it('does not round a typed integer beyond the safe range', () => {
    const raw = '9.007.199.254.740.9910'
    expect(formatAmountInput(raw, { previous: '9.007.199.254.740.991', inputType: 'insertText', data: '0' })).toBe(raw)
  })
  it('keeps the caret with the edited digits instead of moving it to the end', () => {
    expect(amountCaretPosition('1923.456', '1.923.456', 2)).toBe(3)
    expect(amountCaretPosition('1000.000', '1.000.000', 1)).toBe(1)
    expect(amountCaretPosition('-10000', '-10.000', 1)).toBe(1)
  })
  it('normalizes equivalent timestamp representations', () => {
    const state = seed(); state.accounts[0].updatedAt = '2026-11-15T03:00:00+00:00'
    expect(decodeState(state).accounts[0].updatedAt).toBe('2026-11-15T03:00:00.000Z')
  })
})
