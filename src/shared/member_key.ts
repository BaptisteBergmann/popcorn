/**
 * Uniqueness key for member names, shared by server and web.
 * SQLite's lower() only folds ASCII, so names are folded in JS instead.
 */
export const memberKey = (name: string) => name.trim().normalize('NFC').toLocaleLowerCase('fr');
