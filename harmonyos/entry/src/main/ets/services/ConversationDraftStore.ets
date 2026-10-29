import preferences from '@ohos.data.preferences';
import { common } from '@kit.AbilityKit';

export class ConversationDraft {
  key: string = '';
  answer: string = '';
  selected: string[] = [];
  minutes: string = '';
  delivery: string = '';
  mode: string = 'CONDITIONAL_ANALYSIS';
  premiseHash: string = '';
  versionToken: string = '';
}
export class ConversationDraftStore {
  private static entries: ConversationDraft[] = [];
  private static owner: string = '';
  private static store: preferences.Preferences | undefined = undefined;
  private static timer: number = -1;
  private static generation: number = 0;
  private static writes: Promise<void> = Promise.resolve();
  static async bind(context: common.Context, owner: string): Promise<void> {
    if (owner === '') { await ConversationDraftStore.clear(); return; }
    if (ConversationDraftStore.owner === owner && ConversationDraftStore.store !== undefined) return;
    await ConversationDraftStore.writes;
    ConversationDraftStore.entries = []; ConversationDraftStore.owner = owner; ConversationDraftStore.generation++;
    const epoch = ConversationDraftStore.generation;
    const store = await preferences.getPreferences(context, 'projectmemo_conversation_drafts');
    if (epoch !== ConversationDraftStore.generation) return;
    ConversationDraftStore.store = store;
    if (await store.get('owner', '') !== owner) { await store.clear(); await store.put('owner', owner); await store.flush(); return; }
    try {
      const raw = await store.get('drafts', '[]');
      if (typeof raw === 'string') {
        const saved = JSON.parse(raw) as ConversationDraft[];
        if (epoch === ConversationDraftStore.generation && Array.isArray(saved)) ConversationDraftStore.entries = saved.filter((d: ConversationDraft) => typeof d.key === 'string' && typeof d.answer === 'string' && Array.isArray(d.selected)).slice(-64);
      }
    } catch { ConversationDraftStore.entries = []; }
  }
  static read(key: string): ConversationDraft {
    return ConversationDraftStore.entries.find((d: ConversationDraft) => d.key === key) ?? new ConversationDraft();
  }
  static save(key: string, draft: ConversationDraft): void {
    if (ConversationDraftStore.owner === '') return;
    draft.key = key; draft.answer = draft.answer.slice(0, 3000); draft.selected = draft.selected.slice(0, 8);
    ConversationDraftStore.entries = ConversationDraftStore.entries.filter((d: ConversationDraft) => d.key !== key).concat([draft]).slice(-64);
    if (ConversationDraftStore.timer >= 0) clearTimeout(ConversationDraftStore.timer);
    ConversationDraftStore.timer = setTimeout(() => { ConversationDraftStore.flush(); }, 300);
  }
  static flush(): void {
    const store = ConversationDraftStore.store, epoch = ConversationDraftStore.generation, snapshot = JSON.stringify(ConversationDraftStore.entries);
    if (store === undefined) return;
    ConversationDraftStore.writes = ConversationDraftStore.writes.then(async (): Promise<void> => {
      if (epoch !== ConversationDraftStore.generation) return;
      await store.put('drafts', snapshot); await store.flush();
    }).catch((): void => {});
  }
  static async clear(): Promise<void> {
    ConversationDraftStore.generation++; ConversationDraftStore.entries = []; ConversationDraftStore.owner = '';
    if (ConversationDraftStore.timer >= 0) clearTimeout(ConversationDraftStore.timer);
    await ConversationDraftStore.writes;
    const store = ConversationDraftStore.store; ConversationDraftStore.store = undefined;
    if (store !== undefined) { await store.clear(); await store.flush(); }
  }
}
