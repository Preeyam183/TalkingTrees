import type { TreeCareGuide } from "./index.ts";
/** Curated advice stays separate from photo recognition and transactional game rules. */
export function treeCareGuide(
  species: string | null,
  uncertain = false,
): TreeCareGuide {
  const japaneseMaple =
    !uncertain &&
    /japanese maple|acer palmatum|acer japonicum/i.test(species ?? "");
  return {
    title: japaneseMaple
      ? "Caring for a Japanese maple"
      : "Tree care, step by step",
    steps: [
      uncertain || !species
        ? "Confirm the species and the physical tree before choosing a care routine."
        : `Confirm this is ${species} and select the correct nearby tree record.`,
      japaneseMaple
        ? "Check that its site offers shelter from strong winds and harsh sun; Japanese maples usually suit light or dappled shade."
        : "Check soil moisture below the surface and compare it with a fresh, calibrated reading. A photo alone cannot tell whether roots need water.",
      japaneseMaple
        ? "Keep the soil moist with good drainage. Check it before watering; avoid leaving the roots waterlogged."
        : "If the soil is already moist or soggy, skip extra water. If it is dry, agree a watering plan with the caretaker rather than using a fixed schedule.",
      "In the app, water only during an eligible care session. Water the root zone slowly and let it soak in; stop if water pools or runs off.",
      "Keep an organic mulch ring around the root zone, with a clear gap around the trunk. Protect the bark and roots from mowing and foot traffic.",
      "Recheck the soil and readings afterward. Report persistent wilting, damaged bark, or standing water to the caretaker or a qualified arborist.",
    ],
    source_title: japaneseMaple
      ? "RHS Japanese maple growing guide"
      : "University of Minnesota Extension — watering trees",
    source_url: japaneseMaple
      ? "https://www.rhs.org.uk/plants/acer/japanese-maples/growing-guide"
      : "https://extension.umn.edu/garden-and-home/yard-and-garden/gardening-in-minnesota/watering-established-trees-and-shrubs",
    note: "Care depends on species, soil, season, and site. These steps do not diagnose the tree or authorize watering; the app’s current care status still applies.",
  };
}
