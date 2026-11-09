import { useState } from 'react';
import { X } from 'lucide-react';
import { useTags } from '../hooks';

export function TagInput({ value, onChange }: { value: string[]; onChange: (tags: string[]) => void }) {
  const [draft, setDraft] = useState('');
  const { data: all = [] } = useTags();
  const listId = 'tag-suggestions';

  const add = (raw: string) => {
    const t = raw.trim().replace(/^#/, '').toLowerCase();
    if (t && !value.includes(t)) onChange([...value, t]);
    setDraft('');
  };

  return (
    <div className="tag-input">
      {value.map((t) => (
        <span key={t} className="chip tag">
          {t}
          <button onClick={() => onChange(value.filter((x) => x !== t))} aria-label={`Remove tag ${t}`}>
            <X />
          </button>
        </span>
      ))}
      <input
        value={draft}
        list={listId}
        placeholder={value.length ? '+ tag' : '+ add tags'}
        onChange={(e) => {
          const v = e.target.value;
          if (/[,\s]$/.test(v)) add(v.slice(0, -1));
          else setDraft(v);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.preventDefault(), add(draft));
          if (e.key === 'Backspace' && !draft && value.length) onChange(value.slice(0, -1));
        }}
        onBlur={() => draft && add(draft)}
        aria-label="Add tag"
      />
      <datalist id={listId}>
        {all.filter((t) => !value.includes(t.name)).map((t) => <option key={t.name} value={t.name} />)}
      </datalist>
    </div>
  );
}
