import { useState } from "react";
import {
  BACKEND_KINDS,
  formOf,
  type ProfileForm,
  profileFromForm,
} from "~/generate/profile";
import { useServices, useStore } from "./hooks";

/**
 * The world's model: where generations go and with what sampler. Stored in
 * this browser for this world (`generate/profile.ts`); the key is shown
 * masked and never leaves this page except as the request's credentials.
 */
export function ModelSettingsPage() {
  const { generation, workspace } = useServices();
  const saved = useStore(generation.profile);
  const [form, setForm] = useState<ProfileForm>(() => formOf(saved));
  const [showKey, setShowKey] = useState(false);
  const [outcome, setOutcome] = useState<
    { kind: "saved" } | { kind: "problem"; text: string } | null
  >(null);
  const set = (change: Partial<ProfileForm>) => {
    setForm((current) => ({ ...current, ...change }));
    setOutcome(null);
  };
  const readOnly = workspace.readOnly;

  return (
    <div className="settings-sheet">
      <form
        className="settings"
        aria-labelledby="model-settings-title"
        onSubmit={(event) => {
          event.preventDefault();
          const profile = profileFromForm(form);
          if (profile.isErr()) {
            setOutcome({ kind: "problem", text: profile.error });
            return;
          }
          const stored = generation.profile.save(profile.value);
          setOutcome(
            stored.isOk()
              ? { kind: "saved" }
              : { kind: "problem", text: stored.error },
          );
          if (stored.isOk()) setForm(formOf(profile.value));
        }}
      >
        <h1 id="model-settings-title" className="settings-title">
          Model
        </h1>
        <p className="settings-lede">
          Where this world&rsquo;s generations go. These settings stay in this
          browser, for this world only. They are never written into documents,
          stored requests or the record of AI text.
        </p>

        <fieldset className="settings-fields" disabled={readOnly}>
          <label className="settings-field">
            <span className="settings-label">Name</span>
            <input
              value={form.name}
              onChange={(event) => set({ name: event.target.value })}
              autoComplete="off"
            />
            <span className="settings-hint">
              Requests and AI text record it. Renaming the model stops earlier
              AI text from being regenerated.
            </span>
          </label>

          <fieldset className="settings-field settings-kind">
            <legend className="settings-label">Server</legend>
            <div className="settings-switch">
              {BACKEND_KINDS.map(({ kind, label }) => (
                <label key={kind} data-checked={form.kind === kind}>
                  <input
                    type="radio"
                    name="kind"
                    value={kind}
                    checked={form.kind === kind}
                    onChange={() => set({ kind })}
                  />
                  {label}
                </label>
              ))}
            </div>
          </fieldset>

          <label className="settings-field">
            <span className="settings-label">Base URL</span>
            <input
              value={form.baseUrl}
              onChange={(event) => set({ baseUrl: event.target.value })}
              inputMode="url"
              spellCheck={false}
              autoComplete="off"
            />
            <span className="settings-hint">
              Including the version, as in http://localhost:8080/v1 or
              https://openrouter.ai/api/v1.
            </span>
          </label>

          <div className="settings-field">
            <label className="settings-label" htmlFor="model-api-key">
              API key
            </label>
            <div className="settings-key">
              <input
                id="model-api-key"
                type={showKey ? "text" : "password"}
                value={form.apiKey}
                onChange={(event) => set({ apiKey: event.target.value })}
                spellCheck={false}
                autoComplete="off"
                placeholder="None"
              />
              <button
                type="button"
                className="settings-reveal"
                aria-pressed={showKey}
                onClick={() => setShowKey((shown) => !shown)}
              >
                {showKey ? "Hide" : "Show"}
              </button>
            </div>
            <span className="settings-hint">
              Sent only to this server, with each request. A local llama.cpp
              server usually needs none.
            </span>
          </div>

          <label className="settings-field">
            <span className="settings-label">Model</span>
            <input
              value={form.model}
              onChange={(event) => set({ model: event.target.value })}
              spellCheck={false}
              autoComplete="off"
              placeholder="The server's default"
            />
            <span className="settings-hint">
              The model ID the server knows, such as
              meta-llama/llama-3.3-70b-instruct. Leave it empty for the model
              llama.cpp has loaded.
            </span>
          </label>

          <label className="settings-field">
            <span className="settings-label">Sampler</span>
            <textarea
              className="settings-code"
              value={form.sampler}
              onChange={(event) => set({ sampler: event.target.value })}
              spellCheck={false}
              rows={Math.min(14, form.sampler.split("\n").length + 1)}
            />
            <span className="settings-hint">
              A JSON object sent with every request, such as temperature, top_p,
              min_p or max_tokens. You can still change it per request before
              sending.
            </span>
          </label>
        </fieldset>

        <div className="settings-actions">
          <button
            type="submit"
            className="button button-primary"
            disabled={readOnly}
          >
            Save
          </button>
          {outcome?.kind === "saved" && (
            <output className="settings-outcome">Saved for this world.</output>
          )}
          {outcome?.kind === "problem" && (
            <p className="settings-outcome settings-problem" role="alert">
              {outcome.text}
            </p>
          )}
          {readOnly && (
            <p className="settings-outcome">
              This tab is read-only because WorldCrafter is open in another tab.
            </p>
          )}
        </div>
      </form>
    </div>
  );
}
