import { writeBrowserRecord } from "./storage-status";
import { dataStorage } from "./backend-client";
export type PersonalCategory = { id: string; name: string; roomIds: string[] };
type Store = Pick<Storage, "getItem" | "setItem">;

export function createPersonalCategories(storage: Store, accountId: string) {
  storage = dataStorage(storage);
  const key = `church-personal-categories-v1:${accountId}`;
  const list = (): PersonalCategory[] => {
    try {
      const raw = storage.getItem(key);
      if (raw === null) return [];
      const data: unknown = JSON.parse(raw);
      if (!Array.isArray(data) || !data.every(g => g && typeof g.id === "string" && typeof g.name === "string" && Array.isArray(g.roomIds) && g.roomIds.every((id: unknown) => typeof id === "string"))) throw Error();
      return data;
    } catch { throw Error("개인 카테고리를 읽지 못했습니다. 사이트 저장소를 확인해 주세요."); }
  };
  const save = (groups: PersonalCategory[]) => {
    try { writeBrowserRecord(storage, key, groups, "browser"); }
    catch { throw Error("개인 카테고리를 저장하지 못했습니다."); }
    return groups;
  };
  const validate = (groups: PersonalCategory[], name: string, id?: string) => {
    if (!name.trim() || name.trim().length > 20) throw Error("카테고리 이름은 1~20자로 입력해 주세요.");
    if (groups.some(g => g.id !== id && g.name.toLocaleLowerCase() === name.trim().toLocaleLowerCase())) throw Error("같은 이름의 카테고리가 있습니다.");
  };
  return {
    list,
    create(name: string, roomIds: string[]) {
      const groups = list(); validate(groups, name);
      const group = { id: crypto.randomUUID(), name: name.trim(), roomIds: [...new Set(roomIds)] };
      save([...groups, group]); return group;
    },
    update(id: string, name: string, roomIds: string[]) {
      const groups = list(); validate(groups, name, id);
      if (!groups.some(g => g.id === id)) throw Error("카테고리를 찾을 수 없습니다.");
      return save(groups.map(g => g.id === id ? { ...g, name: name.trim(), roomIds: [...new Set(roomIds)] } : g));
    },
    remove(id: string) { return save(list().filter(g => g.id !== id)); }
  };
}
