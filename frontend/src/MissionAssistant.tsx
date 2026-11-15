import { useEffect, useRef, useState, type FormEvent } from 'react';
import { MessageCircle, Send, X } from 'lucide-react';
import { read } from './model';

export type CommanderAction = { kind: string; target: string };
type Message = { role: 'user' | 'model'; text: string };

export function MissionAssistant({ context, onAction }: { context: Record<string, unknown>; onAction: (actions: CommanderAction[]) => Promise<string> }) {
  const [actions, setActions] = useState<CommanderAction[]>([]);
  const [applying, setApplying] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [conversationId, setConversationId] = useState<string>();
  const dialog = useRef<HTMLDialogElement>(null);
  const transcript = useRef<HTMLDivElement>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState('');
  const [pending, setPending] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (transcript.current) transcript.current.scrollTop = transcript.current.scrollHeight;
  }, [messages, pending, error]);

  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = draft.trim();
    if (!text || pending || applying) return;
    const question = { role: 'user', text } satisfies Message;
    setError('');
    setPending(text);
    setDraft('');
    try {
      const { answer, conversation_id, actions: proposed } = await read<{ answer: string; conversation_id: string; actions: CommanderAction[] }>('/ai/chat', {
        messages: [...messages.slice(-4), question], context, conversation_id: conversationId,
      });
      setActions(proposed ?? []);
      setConversationId(conversation_id);
      setMessages(history => [...history, question, { role: 'model', text: answer }]);
    } catch (cause) {
      setDraft(text);
      setError(cause instanceof Error ? cause.message : 'The assistant could not reply.');
    } finally {
      setPending('');
    }
  }

  return <>
    <button className="assistant-launch secondary" onClick={() => dialog.current?.show()}>
      <MessageCircle size={17} aria-hidden="true"/> Mission assistant
    </button>
    <dialog className={`assistant-dialog ${expanded ? "expanded" : ""}`} ref={dialog} aria-labelledby="assistant-title"
      onKeyDown={event => {
        if (event.key === 'Escape') {
          event.preventDefault();
          event.currentTarget.close();
        }
      }}>
      <header>
        <h2 id="assistant-title">Mission Commander</h2>
        <button type="button" onClick={() => setExpanded(value => !value)} aria-label={expanded ? 'Restore panel size' : 'Expand panel'}>{expanded ? 'Restore' : 'Expand'}</button>
        <button type="button" disabled={!!pending || applying} onClick={() => { setActions([]); setMessages([]); setError(''); setDraft(''); setConversationId(undefined); }}>New chat</button>
        <button className="icon" type="button" aria-label="Minimize mission assistant" onClick={() => dialog.current?.close()}>
          <X size={20} aria-hidden="true"/>
        </button>
      </header>
      <div className="assistant-transcript" ref={transcript} role="log" aria-label="Conversation">
        {messages.length === 0 && !pending && <p className="muted">
          Mars Mission Assistant — ask about the current mission, routes, or terrain.
        </p>}
        {messages.length === 0 && !pending && ['Plan a scientific expedition', 'Find geological research targets', 'Analyze this terrain', 'Compare alternative routes', 'Explain potential hazards', 'Generate a mission briefing'].map(question => <button className="secondary" key={question} onClick={() => setDraft(question)}>{question}</button>)}
        {messages.map((message, index) => <div className="assistant-message" key={index}>
          <b>{message.role === 'user' ? 'You' : 'Assistant'}</b>
          <p>{message.text}</p>
        </div>)}
        {pending && <><div className="assistant-message"><b>You</b><p>{pending}</p></div>
          <p className="muted" role="status">Assistant is typing…</p></>}
      </div>
      {actions.length > 0 && <div className="commander-actions"><b>Proposed actions · review before applying</b>{actions.map((action, i) => <p key={i}>{action.kind} · {action.target}</p>)}<button className="primary" disabled={applying || !!pending} onClick={async () => { setApplying(true); setError(''); try { const result = await onAction(actions); setActions([]); setMessages(history => history.map((message, index) => index === history.length - 1 ? { ...message, text: message.text + '\n\nApplication result\n' + result } : message)); } catch (cause) { setError(cause instanceof Error ? cause.message : 'Action failed.'); } finally { setApplying(false); } }}>{applying ? 'Applying…' : 'Apply proposal'}</button></div>}
      <form className="assistant-form" onSubmit={send}>
        {error && <p className="assistant-error" role="alert">{error}</p>}
        <label htmlFor="assistant-question">Your question</label>
        <textarea id="assistant-question" rows={2} maxLength={1500} value={draft} readOnly={!!pending}
          onChange={event => setDraft(event.target.value)} placeholder="Ask a question…" />
        <div className="assistant-actions">
          <small>Messages and current mission context are sent to Google Gemini.</small>
          <button className="secondary" type="submit" disabled={!draft.trim() || !!pending || applying}>
            <Send size={15} aria-hidden="true"/> Send
          </button>
        </div>
      </form>
    </dialog>
  </>;
}
