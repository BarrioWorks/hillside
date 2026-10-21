use serde::Serialize;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Category {
    Building,
    Path,
    Stairs,
    Prop,
}

#[derive(Clone, Copy, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BuildingDefinition {
    pub id: &'static str,
    pub name: &'static str,
    pub category: Category,
    pub width: u32,
    pub depth: u32,
    pub height: f32,
    pub description: &'static str,
    pub color: &'static str,
}

pub const CATALOG: [BuildingDefinition; 11] = [
    BuildingDefinition {
        id: "casa",
        name: "Casa",
        category: Category::Building,
        width: 1,
        depth: 1,
        height: 1.65,
        description: "A colorful home with a roof tank and flower pots.",
        color: "#E9B44C",
    },
    BuildingDefinition {
        id: "tienda",
        name: "Tienda",
        category: Category::Building,
        width: 2,
        depth: 1,
        height: 1.35,
        description: "A neighborhood shop with a shaded storefront.",
        color: "#E77C65",
    },
    BuildingDefinition {
        id: "torre",
        name: "Torre",
        category: Category::Building,
        width: 1,
        depth: 1,
        height: 3.25,
        description: "A narrow brick apartment tower with balconies.",
        color: "#B96547",
    },
    BuildingDefinition {
        id: "terraza",
        name: "Terraza",
        category: Category::Building,
        width: 2,
        depth: 2,
        height: 1.85,
        description: "A broad house with an open planted rooftop terrace.",
        color: "#69AEB5",
    },
    BuildingDefinition {
        id: "taller",
        name: "Taller",
        category: Category::Building,
        width: 2,
        depth: 1,
        height: 1.45,
        description: "A brick workshop with a concrete roof extension.",
        color: "#CB8063",
    },
    BuildingDefinition {
        id: "esquina",
        name: "Esquina",
        category: Category::Building,
        width: 1,
        depth: 2,
        height: 2.45,
        description: "A corner home with stacked rooms and a wraparound balcony.",
        color: "#E7D8B5",
    },
    BuildingDefinition {
        id: "path",
        name: "Path",
        category: Category::Path,
        width: 1,
        depth: 1,
        height: 0.06,
        description: "A paved path connecting neighbors at the same elevation.",
        color: "#C7C2B5",
    },
    BuildingDefinition {
        id: "stairs",
        name: "Stairs",
        category: Category::Stairs,
        width: 1,
        depth: 1,
        height: 0.55,
        description: "Steps facing uphill to the next terrace. Rotate to face the rise.",
        color: "#CFCDC3",
    },
    BuildingDefinition {
        id: "tree",
        name: "Tree",
        category: Category::Prop,
        width: 1,
        depth: 1,
        height: 1.7,
        description: "A leafy tree for a shady neighborhood corner.",
        color: "#398C61",
    },
    BuildingDefinition {
        id: "planter",
        name: "Planter",
        category: Category::Prop,
        width: 1,
        depth: 1,
        height: 0.45,
        description: "A terracotta planter full of green leaves.",
        color: "#B96848",
    },
    BuildingDefinition {
        id: "bench",
        name: "Bench",
        category: Category::Prop,
        width: 1,
        depth: 1,
        height: 0.45,
        description: "A place to sit and watch the neighborhood grow.",
        color: "#A47B51",
    },
];

pub fn definition(kind: &str) -> Option<&'static BuildingDefinition> {
    CATALOG.iter().find(|entry| entry.id == kind)
}

pub fn footprint(definition: &BuildingDefinition, rotation: u32) -> (u32, u32) {
    if rotation % 2 == 1 {
        (definition.depth, definition.width)
    } else {
        (definition.width, definition.depth)
    }
}
