import { useState } from 'react'
import { formatIDR } from '../lib/format'
import { useAccountTypeLabel, useLocale, useT } from '../lib/i18n'
import type { ImportReview, MergeChoices, MergePlan } from '../lib/mergeTypes'

export function ImportMergeReview({ review, plan, choices, onChange, disabled }: { review: ImportReview; plan: MergePlan; choices: MergeChoices; onChange: (choices: MergeChoices) => void; disabled: boolean }) {
  const t = useT(); const locale = useLocale(); const accountType = useAccountTypeLabel()
  const [filter, setFilter] = useState<'pending' | 'all'>('pending'); const [page, setPage] = useState(0)
  const selectClass = 'w-full rounded-input border border-line bg-canvas px-2 py-2 text-[12px] text-ink'
  const buttonClass = 'rounded-button border border-line px-3 py-2 text-[12px] text-ink-muted disabled:opacity-50'
  const setEntity = (key: string, value: string) => onChange({ ...choices, entities: { ...choices.entities, [key]: value } })
  const setValue = (key: string, value: string) => onChange({ ...choices, values: { ...choices.values, [key]: value } })
  const setTransaction = (key: string, value: string) => onChange({ ...choices, transactions: { ...choices.transactions, [key]: value } })
  const candidates = filter === 'pending' ? plan.transactions.filter(row => row.required) : plan.transactions
  const pages = Math.max(1, Math.ceil(candidates.length / 25)); const currentPage = Math.min(page, pages - 1)
  const rows = candidates.slice(currentPage * 25, currentPage * 25 + 25)
  const needsRecovery = plan.mappings.some(row => row.reason === 'deleted') || plan.transactions.some(row => row.kind === 'deleted') || plan.values.some(row => row.deleted)
  const transactionKind = { new: 'mergeTxNew', identical: 'mergeTxIdentical', conflict: 'mergeTxConflict', possible: 'mergeTxPossible', deleted: 'mergeTxDeleted', transfer: 'mergeTxTransfer', dependent: 'mergeTxDependent' } as const
  const rowLabel = (id: string, kind: 'accounts' | 'categories') => plan.state[kind].find(row => row.id === id)?.name ?? '—'
  return <fieldset disabled={disabled} className="min-w-0 space-y-4">
    <p className="text-[12px] text-ink-muted">{t('mergePreserveHint')}</p>
    <p className="text-[11px] text-ink-subtle">{t('mergeIgnored').replace('{deleted}', String(plan.ignoredDeleted)).replace('{purged}', String(plan.ignoredPurged))}</p>
    {needsRecovery && <button disabled={choices.recoverDeleted} className={buttonClass} onClick={() => onChange({ ...choices, recoverDeleted: true })}>{t(choices.recoverDeleted ? 'mergeRecoveryApproved' : 'mergeRecoverDeleted')}</button>}
    <details open className="rounded-input border border-line p-3">
      <summary className="cursor-pointer text-[13px] font-semibold text-ink">{t('mergeMapping')}</summary>
      <p className="mt-2 text-[11px] text-ink-subtle">{t('mergeMappingHint')}</p>
      <div className="mt-3 space-y-3">{plan.mappings.map(row => <div key={row.key} className="grid gap-2 border-t border-line pt-3 sm:grid-cols-2">
        <div className="text-[12px] text-ink-muted">
          <p className="font-medium text-ink">{row.source.name}</p>
          <p>{row.kind === 'accounts' ? t('account') : t('category')} · {row.source.type === 'income' ? t('incomeShort') : row.source.type === 'expense' ? t('expense') : accountType(row.source.type)}</p>
          {row.reason && <p className="mt-1 text-warning">{t(row.reason === 'deleted' ? 'mergeDeletedMapping' : row.reason === 'invalid' ? 'mergeInvalidMapping' : 'mergeIdentityMapping')}</p>}
        </div>
        <div>
          <select aria-label={`${t(row.kind === 'accounts' ? 'mapAccount' : 'mapCategory')} ${row.source.name}`} value={row.selected} onChange={event => setEntity(row.key, event.target.value)} className={selectClass}>
            <option value="">{t('mergeChooseTarget')}</option>
            {review.workspace.state[row.kind].filter(target => !target.deletedAt && (row.kind === 'accounts' || target.type === row.source.type)).map(target => <option key={target.id} value={target.id}>{target.name} · {target.type === 'income' ? t('incomeShort') : target.type === 'expense' ? t('expense') : accountType(target.type)}</option>)}
            <option value="new">{t('mergeNewEntity')}</option>
            <option value="skip">{t('mergeSkipEntity')}</option>
          </select>
          {row.selected === 'new' && <input aria-label={`${t('mergeNewName')} ${row.source.name}`} value={row.name} onChange={event => onChange({ ...choices, names: { ...choices.names, [row.key]: event.target.value } })} className={`${selectClass} mt-2`} />}
        </div>
      </div>)}</div>
    </details>
    {plan.values.length > 0 && <details open className="rounded-input border border-line p-3">
      <summary className="cursor-pointer text-[13px] font-semibold text-ink">{t('mergeValues')}</summary>
      <p className="mt-2 text-[11px] text-ink-subtle">{t('mergeValuesHint')}</p>
      {plan.values.some(row => row.required && row.current !== undefined) && <button className={`${buttonClass} mt-2`} onClick={() => onChange({ ...choices, values: { ...choices.values, ...Object.fromEntries(plan.values.filter(row => row.current !== undefined).map(row => [row.key, 'local'])) } })}>{t('mergeKeepLocalValues')}</button>}
      <div className="mt-3 space-y-3">{plan.values.map(row => <div key={row.key}>
        <label className="mb-1 block text-[12px] text-ink-muted">{t(row.kind === 'balance' ? 'startingBalance' : 'budgetLimit')} · {row.name}</label>
        {row.deleted && <p className="mb-1 text-[11px] text-warning">{t('mergeDeletedValue')}</p>}
        <select aria-label={`${t(row.kind === 'balance' ? 'mergeBalanceChoice' : 'mergeBudgetChoice')} ${row.name}`} value={row.selected} onChange={event => setValue(row.key, event.target.value)} className={selectClass}>
          <option value="">{t('mergeChooseValue')}</option>
          {row.current !== undefined && <option value="local">{t('mergeUseLocal')}: {formatIDR(row.current, locale)}</option>}
          {row.sources.map(source => <option key={source.id} value={`source:${source.id}`}>{t('mergeUseSource')}: {formatIDR(source.value, locale)} · {source.name}</option>)}
        </select>
      </div>)}</div>
    </details>}
    {plan.transactions.length > 0 && <details open className="rounded-input border border-line p-3">
      <summary className="cursor-pointer text-[13px] font-semibold text-ink">{t('mergeTransactions')} ({plan.transactions.length})</summary>
      <p className="mt-2 text-[11px] text-ink-subtle">{t('mergeTransactionsHint')}</p>
      <div className="mt-2 flex flex-wrap gap-2">
        <button className={buttonClass} onClick={() => { setFilter(filter === 'pending' ? 'all' : 'pending'); setPage(0) }}>{t(filter === 'pending' ? 'mergeShowAll' : 'mergeShowPending')}</button>
        {plan.transactions.some(row => row.kind === 'possible' && row.required) && <button className={buttonClass} onClick={() => onChange({ ...choices, transactions: { ...choices.transactions, ...Object.fromEntries(plan.transactions.filter(row => row.kind === 'possible' && row.required).map(row => [row.source.id, 'add'])) } })}>{t('mergeAddAllSeparate')}</button>}
      </div>
      {!rows.length && <p className="mt-3 text-[12px] text-ink-subtle">{t('mergeNoPendingTransactions')}</p>}
      <div className="mt-3 space-y-3">{rows.map(row => <div key={row.source.id} className="border-t border-line pt-3 text-[12px]">
        <p className="font-medium text-ink">{row.source.date} · {formatIDR(row.source.amount, locale)} · {t(row.source.type === 'expense' ? 'expense' : row.source.type === 'income' ? 'incomeShort' : 'transfer')}</p>
        <p className="text-ink-muted">{row.mapped ? `${rowLabel(row.mapped.accountId, 'accounts')} · ${row.mapped.type === 'transfer' ? rowLabel(row.mapped.targetAccountId!, 'accounts') : rowLabel(row.mapped.categoryId!, 'categories')}` : t('mergeTxDependent')}</p>
        {row.source.note && <p className="break-words text-ink-subtle">{t('mergeSourceNote')}: {row.source.note}</p>}
        <p className={`mt-1 ${row.required ? 'text-warning' : 'text-ink-subtle'}`}>{t(transactionKind[row.kind])}</p>
        {row.local && <p className="mt-1 break-words text-ink-muted">{t('mergeCurrentTransaction')}: {row.local.date} · {formatIDR(row.local.amount, locale)} · {rowLabel(row.local.accountId, 'accounts')} · {row.local.type === 'transfer' ? rowLabel(row.local.targetAccountId!, 'accounts') : rowLabel(row.local.categoryId!, 'categories')} · {row.local.note ?? '—'}</p>}
        {row.kind !== 'dependent' && <select aria-label={`${t('mergeTransactionChoice')} ${row.source.id}`} value={row.selected} onChange={event => setTransaction(row.source.id, event.target.value)} className={`${selectClass} mt-2`}>
          <option value="">{t('mergeChooseTransaction')}</option>
          {row.local ? <>
            <option value="local">{t('mergeKeepTransaction')}</option>
            <option value="incoming">{t('mergeUpdateTransaction')}</option>
            <option value="copy">{t('mergeCopyTransaction')}</option>
          </> : row.kind !== 'transfer' && <option value="add">{t('mergeCopyTransaction')}</option>}
          <option value="skip">{t('mergeSkipTransaction')}</option>
          {row.candidates.map(candidate => <option key={candidate.id} value={`match:${candidate.id}`}>{t('mergeMatchTransaction')}: {candidate.date} · {formatIDR(candidate.amount, locale)} · {candidate.note ?? '—'}</option>)}
        </select>}
      </div>)}</div>
      {pages > 1 && <div className="mt-3 flex items-center justify-between gap-2 text-[12px] text-ink-muted">
        <button className={buttonClass} disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>{t('mergePreviousPage')}</button>
        <span>{currentPage + 1} / {pages}</span>
        <button className={buttonClass} disabled={currentPage + 1 === pages} onClick={() => setPage(currentPage + 1)}>{t('mergeNextPage')}</button>
      </div>}
    </details>}
  </fieldset>
}
