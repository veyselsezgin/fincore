import { ENGINE_VERSION } from '@fincore/engine';
import { useDeferredValue, useEffect, useMemo, useState } from 'react';
import { FieldInput } from './components/Fields';
import { ResultPanel } from './components/ResultPanel';
import {
  CALCULATORS,
  defaults,
  type Action,
  type Calculator,
  type Computation,
  type Values,
} from './registry';
import { decodeScenario, loadSession, saveSession, SCENARIO_PARAM, scenarioUrl } from './session';

const byId = new Map(CALCULATORS.map((c) => [c.id, c]));
const categories = [...new Set(CALCULATORS.map((c) => c.category))];

function useHashRoute(): [string, (id: string) => void] {
  const read = () => window.location.hash.replace(/^#\/?/, '') || CALCULATORS[0]!.id;
  const [id, setId] = useState(read);
  useEffect(() => {
    const on = () => setId(read());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return [id, (next) => (window.location.hash = `/${next}`)];
}

/**
 * Initial inputs: the saved session, overlaid with a scenario from a shared link if present.
 * The scenario parameter is then removed from the address bar so a reload does not re-apply it
 * over later edits (the session takes over from there).
 */
function initialState(): { inputs: Record<string, Values>; shared: string | null } {
  const inputs = loadSession(CALCULATORS);
  const token = new URLSearchParams(window.location.search).get(SCENARIO_PARAM);
  if (!token) return { inputs, shared: null };
  const scenario = decodeScenario(token, CALCULATORS);
  const clean = `${window.location.pathname}${scenario ? `#/${scenario.calcId}` : window.location.hash}`;
  window.history.replaceState(null, '', clean);
  if (!scenario) return { inputs, shared: null };
  const calc = byId.get(scenario.calcId)!;
  inputs[calc.id] = { ...defaults(calc), ...scenario.values };
  return { inputs, shared: calc.id };
}

export function App() {
  const [init] = useState(initialState);
  const [routeId, go] = useHashRoute();
  const calc = byId.get(routeId) ?? CALCULATORS[0]!;
  // Inputs are kept per calculator, so switching back and forth keeps what you typed.
  const [inputs, setInputs] = useState<Record<string, Values>>(init.inputs);
  // Stable identity unless the inputs change: the (possibly heavy) computation is memoised on it.
  const values = useMemo(() => ({ ...defaults(calc), ...inputs[calc.id] }), [calc, inputs]);
  const setValues = (v: Values) => setInputs((all) => ({ ...all, [calc.id]: v }));
  const [flash, setFlash] = useState<{ target: string; message: string } | null>(
    init.shared ? { target: init.shared, message: 'Scenario loaded from a shared link.' } : null,
  );

  // Persist the session (debounced): inputs survive reloads and browser restarts.
  useEffect(() => {
    const t = setTimeout(() => saveSession(inputs), 300);
    return () => clearTimeout(t);
  }, [inputs]);

  /** Hand-off between calculators: patch the target's inputs, then navigate to it. */
  const runAction = (a: Action) => {
    const target = byId.get(a.target);
    if (!target) return;
    setInputs((all) => ({
      ...all,
      [a.target]: { ...defaults(target), ...all[a.target], ...a.patch },
    }));
    setFlash({ target: a.target, message: a.message });
    go(a.target);
    window.scrollTo({ top: 0 });
  };

  return (
    <div className="layout">
      <aside className="sidebar">
        <div className="brand">
          <span className="logo">ƒ</span>
          <span>
            FinCore
            <small>Corporate Finance Terminal</small>
          </span>
        </div>
        <nav>
          {categories.map((cat) => (
            <div key={cat} className="nav-group">
              <div className="nav-title">{cat}</div>
              {CALCULATORS.filter((c) => c.category === cat).map((c) => (
                <a
                  key={c.id}
                  href={`#/${c.id}`}
                  className={c.id === calc.id ? 'active' : ''}
                  onClick={(e) => {
                    e.preventDefault();
                    setFlash(null);
                    go(c.id);
                  }}
                >
                  {c.title}
                </a>
              ))}
            </div>
          ))}
        </nav>
        <p className="sidebar-note">
          Deterministic engine v{ENGINE_VERSION}. All outputs derive from user inputs only: no
          market data feeds, no model estimates. Session saved in this browser.
        </p>
      </aside>
      <main>
        <CalculatorView
          key={calc.id}
          calc={calc}
          values={values}
          setValues={setValues}
          reset={() => setValues(defaults(calc))}
          flash={flash?.target === calc.id ? flash.message : null}
          dismissFlash={() => setFlash(null)}
          onAction={runAction}
        />
      </main>
    </div>
  );
}

interface ViewProps {
  calc: Calculator;
  values: Values;
  setValues: (v: Values) => void;
  reset: () => void;
  flash: string | null;
  dismissFlash: () => void;
  onAction: (a: Action) => void;
}

function CalculatorView({
  calc,
  values,
  setValues,
  reset,
  flash,
  dismissFlash,
  onAction,
}: ViewProps) {
  // Heavy calculators (Monte Carlo) recompute on a deferred copy so typing stays responsive.
  const deferred = useDeferredValue(values);
  const computation: Computation = useMemo(() => {
    try {
      return calc.compute(deferred);
    } catch (e) {
      // Should never happen (engine returns errors instead of throwing); surface it loudly if it does.
      return {
        result: {
          status: 'error',
          value: null,
          steps: [],
          assumptions: [],
          warnings: [],
          errors: [{ code: 'UI_EXCEPTION', message: String(e) }],
          formulaId: calc.id,
          engineVersion: ENGINE_VERSION,
        },
      };
    }
  }, [calc, deferred]);

  const badFields = new Set(computation.result.errors.map((e) => e.field).filter(Boolean));
  const isVisible = (f: Calculator['fields'][number]) => !f.visible || f.visible(values);
  const formFields = calc.fields.filter((f) => f.placement !== 'view' && isVisible(f));

  const renderField = (key: string) => {
    const f = calc.fields.find((x) => x.key === key);
    if (!f || !isVisible(f)) return null;
    return (
      <FieldInput
        key={f.key}
        field={f}
        value={values[f.key] ?? f.default}
        invalid={badFields.has(f.engineField ?? f.key)}
        onChange={(v) => setValues({ ...values, [f.key]: v })}
      />
    );
  };

  return (
    <div className="calculator">
      <header>
        <div className="topbar">
          <div className="crumb">
            {calc.category} / {calc.title}
          </div>
          <div className="chips">
            <span className="chip live">Live recalculation</span>
            <span className="chip">Engine v{ENGINE_VERSION}</span>
            <span className="chip">Local session · no market data</span>
          </div>
        </div>
        <h1>{calc.title}</h1>
        <p className="description">{calc.description}</p>
        {flash && (
          <div className="flash" role="status">
            <span>{flash}</span>
            <button type="button" className="link" onClick={dismissFlash} aria-label="Dismiss">
              ×
            </button>
          </div>
        )}
        {computation.view?.alerts?.map((a) => (
          <div key={a.title} className="alert-banner" role="alert">
            <div className="alert-title">
              <span className="alert-icon">!</span>
              {a.title}
            </div>
            <p>{a.message}</p>
            <ul>
              {a.items.map((i) => (
                <li key={i}>{i}</li>
              ))}
            </ul>
          </div>
        ))}
      </header>
      <div className={`workspace ${calc.layout === 'wide' ? 'wide' : ''}`}>
        <form className="inputs" onSubmit={(e) => e.preventDefault()}>
          <div className="inputs-head">
            <h2>Parameters</h2>
            <div className="inputs-actions">
              <CopyLinkButton calcId={calc.id} values={values} />
              <button
                type="button"
                className="link"
                onClick={reset}
                title="Restore the worked example"
              >
                Load Sample Case
              </button>
            </div>
          </div>
          {formFields.map((f) => renderField(f.key))}
        </form>
        <ResultPanel
          calc={calc}
          values={deferred}
          computation={computation}
          onAction={onAction}
          renderField={renderField}
        />
      </div>
    </div>
  );
}

function CopyLinkButton({ calcId, values }: { calcId: string; values: Values }) {
  const [state, setState] = useState<'idle' | 'copied' | { manual: string }>('idle');
  const copy = async () => {
    const url = scenarioUrl(calcId, values, window.location);
    try {
      await navigator.clipboard.writeText(url);
      setState('copied');
      setTimeout(() => setState('idle'), 2000);
    } catch {
      setState({ manual: url }); // clipboard blocked: show the link to copy by hand
    }
  };
  return (
    <>
      <button
        type="button"
        className="link"
        onClick={copy}
        title="Copy a link that reopens this case with the current inputs"
      >
        {state === 'copied' ? 'Link Copied ✓' : 'Copy Scenario Link'}
      </button>
      {typeof state === 'object' && (
        <input
          className="manual-link"
          readOnly
          value={state.manual}
          onFocus={(e) => e.target.select()}
          aria-label="Scenario link"
          autoFocus
        />
      )}
    </>
  );
}
