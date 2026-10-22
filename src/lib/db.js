// The one door screens use for data. It picks a backend once, at start-up:
//   VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY set  ->  "live": Supabase, shared by every phone (remote.js)
//   otherwise                                          ->  "demo": this browser only, no server (local.js)
// Both backends expose exactly the same functions. Rules and selectors shared by both live in core.js.
import * as local from "./local.js";
import * as remote from "./remote.js";

export * from "./core.js";

export const MODE = import.meta.env?.VITE_SUPABASE_URL && import.meta.env?.VITE_SUPABASE_ANON_KEY ? "live" : "demo";
const B = MODE === "live" ? remote : local;

export const useDb = B.useDb;
export const getState = B.getState;
export const init = B.init;
export const signUp = B.signUp;
export const signIn = B.signIn;
export const staffSignIn = B.staffSignIn;
export const signOut = B.signOut;
export const continueAsGuest = B.continueAsGuest;
export const changeStaffPassword = B.changeStaffPassword;
export const resetPin = B.resetPin;
export const savePlayer = B.savePlayer;
export const removePlayer = B.removePlayer;
export const adminSavePlayer = B.adminSavePlayer;
export const adminRemovePlayer = B.adminRemovePlayer;
export const register = B.register;
export const withdraw = B.withdraw;
export const setPaid = B.setPaid;
export const saveTournament = B.saveTournament;
export const deleteTournament = B.deleteTournament;
export const saveCategory = B.saveCategory;
export const deleteCategory = B.deleteCategory;
export const addStarterCategories = B.addStarterCategories;
export const saveStage = B.saveStage;
export const deleteStage = B.deleteStage;
export const moveStage = B.moveStage;
export const resetAllData = B.resetAllData;
export const saveOrganiser = B.saveOrganiser;
export const deleteOrganiser = B.deleteOrganiser;
export const grantOrganiser = B.grantOrganiser;
export const generateStage = B.generateStage;
export const saveMatch = B.saveMatch;
export const deleteMatch = B.deleteMatch;
export const setSchedule = B.setSchedule;
export const clearScore = B.clearScore;
export const saveScore = B.saveScore;
export const clearStage = B.clearStage;
export const ensureDemoAdmin = B.ensureDemoAdmin ?? (async () => {});
