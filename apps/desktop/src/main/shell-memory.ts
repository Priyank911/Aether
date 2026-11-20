import type { MemoryStore } from '@aether/memory';
import { MemoryListingSchema, type MemoryCommand, type MemoryListing } from '@aether/shared';

/** Called only by the trusted shell IPC; never creates an agent session for Personal. */
export function shellMemory(store: MemoryStore, command: MemoryCommand): MemoryListing {
  let error: string | undefined;
  try {
    if (command.op === 'delete' && command.kind && command.id !== undefined) store.delete(command.kind, command.id);
    else if (command.op === 'set_enabled' && command.enabled !== undefined) store.setEnabled(command.enabled);
    else if (command.op === 'save_fact') {
      if (!command.key?.trim() || !command.value?.trim()) throw new Error('Enter a preference name and value.');
      store.saveFact(command.key, command.value, 'user');
    }
  } catch (caught) {
    error = caught instanceof Error ? caught.message : String(caught);
  }
  return MemoryListingSchema.parse({
    type: 'aether.memory.listing', enabled: store.enabled,
    facts: store.facts(), notes: store.notes(), procedures: store.procedures(),
    ...(error ? { error } : {}),
  });
}
