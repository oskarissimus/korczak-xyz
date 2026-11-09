// The table lives beside the game's logic (`utils/rpg/translations.ts`) because the Cloud Functions
// compile it to translate the interface (`functions/src/rpg/ui.ts`), and only `utils/rpg` has the
// tsconfig their CI can read. Imported from here by the components, as before.
export { translations } from '../../utils/rpg/translations';
