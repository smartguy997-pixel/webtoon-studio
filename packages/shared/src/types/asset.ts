export type AssetRole = "protagonist" | "antagonist" | "supporting";
export type LocationType = "interior" | "exterior" | "landmark";

export interface CharacterAppearance {
  face: string;
  body: string;
  hair: string;
  outfit: string;
  distinguishing_features: string;
}

export interface Character {
  id: string; // char_NNN
  name: string;
  role: AssetRole;
  age: string;
  personality: string;
  appearance: CharacterAppearance;
  ability: string;
  arc: string;
}

export interface Location {
  id: string; // loc_NNN
  name: string;
  type: LocationType;
  atmosphere: string;
  structure: string;
  first_appearance: string;
}

export interface Prop {
  id: string; // prop_NNN
  name: string;
  function: string;
  appearance: string;
  owner: string | null;
}

export interface AssetList {
  characters: Character[];
  locations: Location[];
  props: Prop[];
}

export interface DesignOption {
  target_id: string;
  target_name: string;
  target_type: "character" | "location";
  option_a: string;
  option_b: string;
  selected: "A" | "B" | null;
}

export interface ApprovedAsset extends Character {
  selected_option: "A" | "B";
  final_prompt: string;
  ref_image_id: string;
  locked: boolean;
  created_at: string;
}
