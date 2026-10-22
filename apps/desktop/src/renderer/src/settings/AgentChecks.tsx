// The agents of this computer that may use a connector (Settings → Connectors).
import type { Agent } from '@lonca/protocol';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { remoteOwner } from '../agents/owner';
import { useApp } from '../store';

const NO_AGENTS: Agent[] = [];

/** This computer's own agents in the open workspace: only they can use this computer's connectors. */
export function useOwnAgents(): Agent[] {
  const ws = useApp((s) => s.workspace);
  const agents = ws?.agents ?? NO_AGENTS;
  return useMemo(() => agents.filter((a) => !remoteOwner(a, ws)), [agents, ws]);
}

/** The agents of this computer that may use a connector. */
export function AgentChecks({ chosen, onChange }: { chosen: string[]; onChange: (next: string[]) => void }) {
  const { t } = useTranslation();
  const agents = useOwnAgents();
  return (
    <fieldset className="l-field advform__channels">
      <legend className="l-field__label">{t('connectors.agents')}</legend>
      {agents.length === 0 ? (
        <span className="muted">{t('connectors.noAgents')}</span>
      ) : (
        <div className="advform__checks">
          {agents.map((a) => (
            <label key={a.id} className="advform__check">
              <input
                type="checkbox"
                checked={chosen.includes(a.id)}
                onChange={(e) => onChange(e.target.checked ? [...chosen, a.id] : chosen.filter((id) => id !== a.id))}
              />
              <span>{a.name}</span>
            </label>
          ))}
        </div>
      )}
      <span className="l-field__hint">{t('connectors.agentsHint')}</span>
    </fieldset>
  );
}
