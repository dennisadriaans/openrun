import { createFileRoute } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import { Pencil, Plus, Trash2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import * as fns from '../fns'
import { Button, Card, Field, Modal, PageHeader, inputClass } from '../components/ui'
import {
  invalidArgsTemplateMessage,
  isValidArgsTemplate,
  parseArgsTemplate,
} from '../lib/argsTemplate'
import { RUNTIME_PRESETS, type RuntimePreset } from '../lib/runtimePresets'
import {
  TRANSPORT_DESCRIPTIONS,
  TRANSPORT_LABELS,
  acpLaunchPresetFor,
  parseTransport,
  type RuntimeTransport,
} from '../lib/acpTransport'
import { modelKindForBin } from '../lib/models'
import { useCommandPreview, usePresetBins, useRuntimes } from '../lib/queries'
import { CommandPreview } from '../components/CommandPreview'
import { useDebouncedValue } from '../hooks/useDebouncedValue'

export const Route = createFileRoute('/runtimes')({ component: RuntimesPage })

type RuntimeForm = {
  id?: string
  label: string
  bin: string
  argsTemplate: string
  promptViaStdin: boolean
  description: string
  enabled: boolean
  canOpenPrs: boolean
  transport: RuntimeTransport
}

const emptyForm: RuntimeForm = {
  label: '',
  bin: '',
  argsTemplate: '[]',
  promptViaStdin: true,
  description: '',
  enabled: true,
  canOpenPrs: false,
  transport: 'cli',
}

function formFromPreset(preset: RuntimePreset): RuntimeForm {
  return {
    id: preset.id,
    label: preset.label,
    bin: preset.bin,
    argsTemplate: JSON.stringify(preset.argsTemplate),
    promptViaStdin: preset.promptViaStdin,
    description: preset.description,
    enabled: true,
    canOpenPrs: !!preset.canOpenPrs,
    transport: preset.transport ?? 'cli',
  }
}

function isAcp(transport: string | undefined): boolean {
  return parseTransport(transport) === 'acp'
}

function formatArgsPreview(argsTemplate: string): string {
  try {
    return parseArgsTemplate(argsTemplate).join(' ')
  } catch {
    return '(invalid args template)'
  }
}

function RuntimesPage() {
  const { data: runtimes, isLoading } = useRuntimes()
  const { data: presetBins } = usePresetBins()
  const qc = useQueryClient()
  const [editing, setEditing] = useState<RuntimeForm | null>(null)

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['runtimes'] })
    void qc.invalidateQueries({ queryKey: ['presetBins'] })
  }
  const existingIds = new Set(runtimes?.map((r) => r.id) ?? [])
  const binOnPath = new Map((presetBins ?? []).map((b) => [b.bin, b.installed]))

  const save = async (form: RuntimeForm) => {
    if (!isValidArgsTemplate(form.argsTemplate)) {
      alert(invalidArgsTemplateMessage(form.argsTemplate))
      return
    }
    try {
      await fns.saveRuntime({ data: form })
      setEditing(null)
      refresh()
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err))
    }
  }

  const remove = async (id: string, label: string) => {
    if (!confirm(`Delete runtime "${label}"? Automations using it will fail until reassigned.`))
      return
    await fns.removeRuntime({ data: { id } })
    refresh()
  }

  return (
    <div className="mx-auto max-w-5xl px-6 py-6">
      <PageHeader
        title="Runtimes"
        actions={
          <Button variant="primary" onClick={() => setEditing({ ...emptyForm })}>
            <Plus className="h-3.5 w-3.5" /> New
          </Button>
        }
      />

      <section className="mb-6">
        <h2 className="mb-2 text-sm font-medium text-tier-secondary">Presets</h2>
        <p className="mb-3 text-ui-sm text-tier-tertiary">
          One-click known-good headless templates for CLIs on this machine.
        </p>
        <div className="flex flex-wrap gap-2">
          {RUNTIME_PRESETS.filter(
            (preset) => existingIds.has(preset.id) || binOnPath.get(preset.bin) === true,
          ).map((preset) => {
            const installed = existingIds.has(preset.id)
            return (
              <Button
                key={preset.id}
                variant="default"
                disabled={installed}
                title={installed ? 'Already added' : preset.description}
                onClick={() => setEditing(formFromPreset(preset))}
              >
                {preset.label}
                {installed ? ' · added' : ''}
              </Button>
            )
          })}
        </div>
      </section>

      {isLoading ? (
        <div className="py-16 text-center text-ui-base text-tier-tertiary">Loading…</div>
      ) : (
        <Card className="divide-y divide-[var(--border-quaternary)]">
          {runtimes?.map((r) => (
            <div key={r.id} className="group flex items-center justify-between gap-4 px-4 py-3">
              <div className="min-w-0">
                <div className="flex items-baseline gap-2">
                  <span className="text-ui-base text-foreground">{r.label}</span>
                  {r.description ? (
                    <span className="truncate text-ui-sm text-tier-tertiary">{r.description}</span>
                  ) : null}
                </div>
                <div className="mt-0.5 truncate mono text-ui-sm text-tier-quaternary">
                  {r.bin} {formatArgsPreview(r.argsTemplate)}
                  {r.promptViaStdin && !isAcp(r.transport) ? '  ‹ stdin' : ''}
                </div>
                {isAcp(r.transport) ? (
                  <div className="mt-1 text-ui-sm text-tier-tertiary">Agent Client Protocol</div>
                ) : null}
                {!isValidArgsTemplate(r.argsTemplate) ? (
                  <div className="mt-1 text-ui-sm text-danger">invalid args template</div>
                ) : null}
              </div>
              <div className="flex shrink-0 items-center gap-1">
                {r.installed ? (
                  <span
                    className="text-ui-sm text-tier-quaternary"
                    title={r.path ?? 'Found on PATH'}
                  >
                    on PATH
                  </span>
                ) : (
                  <span
                    className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-ui-sm text-tier-secondary ring-1 ring-inset ring-border"
                    title="Binary not found on PATH — install the CLI or edit the binary name"
                  >
                    <span className="h-1.5 w-1.5 rounded-full bg-danger" />
                    not found
                  </span>
                )}
                <div className="ml-1 flex gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                  <Button
                    variant="ghost"
                    aria-label={`Edit ${r.label}`}
                    onClick={() =>
                      setEditing({
                        id: r.id,
                        label: r.label,
                        bin: r.bin,
                        argsTemplate: r.argsTemplate,
                        promptViaStdin: !!r.promptViaStdin,
                        description: r.description,
                        enabled: !!r.enabled,
                        canOpenPrs: !!r.canOpenPrs,
                        transport: parseTransport(r.transport),
                      })
                    }
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    aria-label={`Delete ${r.label}`}
                    onClick={() => remove(r.id, r.label)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </Card>
      )}

      {editing ? (
        <RuntimeModal
          value={editing}
          onChange={setEditing}
          onClose={() => setEditing(null)}
          onSave={() => save(editing)}
        />
      ) : null}
    </div>
  )
}

function RuntimeModal({
  value,
  onChange,
  onClose,
  onSave,
}: {
  value: RuntimeForm
  onChange: (v: RuntimeForm) => void
  onClose: () => void
  onSave: () => void
}) {
  const set = <K extends keyof RuntimeForm>(k: K, v: RuntimeForm[K]) =>
    onChange({ ...value, [k]: v })

  // Switching to ACP turns off stdin piping: the prompt travels as a
  // `session/prompt` message, so a template that pipes it would send it twice.
  const applyTransport = (transport: RuntimeTransport) =>
    onChange({
      ...value,
      transport,
      promptViaStdin: transport === 'acp' ? false : value.promptViaStdin,
    })

  const acpPreset = acpLaunchPresetFor(modelKindForBin(value.bin))

  // Resolve the draft against the real spawn path so the editor shows the argv
  // Open Run would run — including the flags it injects on top of the template.
  // Debounced: typing in the template shouldn't resolve PATH on every keystroke.
  const draft = useDebouncedValue(
    useMemo(
      () => ({
        bin: value.bin,
        argsTemplate: value.argsTemplate,
        promptViaStdin: value.promptViaStdin,
      }),
      [value.bin, value.argsTemplate, value.promptViaStdin],
    ),
  )
  const { data: preview, isFetching } = useCommandPreview(draft)

  return (
    <Modal title={value.id ? 'Edit runtime' : 'Add runtime'} onClose={onClose} wide>
      <div className="space-y-4">
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Label">
            <input
              className={inputClass}
              value={value.label}
              onChange={(e) => set('label', e.target.value)}
              placeholder="Claude Code"
            />
          </Field>
          <Field label="Binary" hint="resolved on PATH">
            <input
              className={`${inputClass} mono`}
              value={value.bin}
              onChange={(e) => set('bin', e.target.value)}
              placeholder="claude"
            />
          </Field>
        </div>
        <Field label="Description" hint="optional">
          <input
            className={inputClass}
            value={value.description}
            onChange={(e) => set('description', e.target.value)}
          />
        </Field>
        <Field label="Transport" hint="how Open Run talks to this agent">
          <div className="space-y-2">
            {(['cli', 'acp'] as const).map((t) => (
              <label key={t} className="flex items-start gap-2.5">
                <input
                  type="radio"
                  name="transport"
                  className="mt-1 h-3.5 w-3.5 accent-[var(--base)]"
                  checked={value.transport === t}
                  onChange={() => applyTransport(t)}
                />
                <span className="text-ui-base text-tier-secondary">
                  {TRANSPORT_LABELS[t]}
                  <span className="ml-1.5 text-ui-sm text-tier-quaternary">
                    {TRANSPORT_DESCRIPTIONS[t]}
                  </span>
                </span>
              </label>
            ))}
            {value.transport === 'acp' && acpPreset ? (
              <div className="text-ui-sm text-tier-quaternary">
                {acpPreset.note}{' '}
                <button
                  type="button"
                  className="underline underline-offset-2 hover:text-tier-secondary"
                  onClick={() =>
                    onChange({
                      ...value,
                      transport: 'acp',
                      bin: acpPreset.bin,
                      argsTemplate: JSON.stringify(acpPreset.args),
                    })
                  }
                >
                  Use <span className="mono">{[acpPreset.bin, ...acpPreset.args].join(' ')}</span>
                </button>
              </div>
            ) : null}
          </div>
        </Field>
        <Field
          label={
            value.transport === 'acp' ? 'Launch args (JSON array)' : 'Args template (JSON array)'
          }
          hint={
            <span className="mono">
              {'{prompt}'}, {'{promptFile}'}, and {'{cwd}'} are substituted
            </span>
          }
        >
          <textarea
            className={`${inputClass} min-h-24 mono text-[12.5px]`}
            value={value.argsTemplate}
            onChange={(e) => set('argsTemplate', e.target.value)}
            placeholder='["-p", "--output-format", "text"]'
          />
        </Field>
        {value.transport === 'cli' ? (
          <>
            <label className="flex items-center gap-2.5">
              <input
                type="checkbox"
                className="h-3.5 w-3.5 accent-[var(--base)]"
                checked={value.promptViaStdin}
                onChange={(e) => set('promptViaStdin', e.target.checked)}
              />
              <span className="text-ui-base text-tier-secondary">
                Pipe prompt to stdin
                <span className="ml-1.5 text-ui-sm text-tier-quaternary">
                  (off = use {'{prompt}'} or {'{promptFile}'} in args)
                </span>
              </span>
            </label>
            <CommandPreview
              preview={preview?.preview}
              error={preview?.error}
              isLoading={isFetching}
            />
          </>
        ) : (
          <div className="rounded-lg border border-border bg-chrome/60 px-3 py-2 text-ui-sm text-tier-tertiary">
            The prompt is sent as an ACP <span className="mono">session/prompt</span> message, and
            tool approvals, plans and file locations come from the protocol. The args above only
            launch the agent.
          </div>
        )}
        <label className="flex items-center gap-2.5">
          <input
            type="checkbox"
            className="h-3.5 w-3.5 accent-[var(--base)]"
            checked={value.canOpenPrs}
            onChange={(e) => set('canOpenPrs', e.target.checked)}
          />
          <span className="text-ui-base text-tier-secondary">
            May open pull requests
            <span className="ml-1.5 text-ui-sm text-tier-quaternary">
              (adds a prompt telling the agent it can branch, push &amp; `gh pr create`)
            </span>
          </span>
        </label>
        <label className="flex items-center gap-2.5">
          <input
            type="checkbox"
            className="h-3.5 w-3.5 accent-[var(--base)]"
            checked={value.enabled}
            onChange={(e) => set('enabled', e.target.checked)}
          />
          <span className="text-ui-base text-tier-secondary">Enabled</span>
        </label>
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={onSave}>
            {value.id ? 'Save changes' : 'Add runtime'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
