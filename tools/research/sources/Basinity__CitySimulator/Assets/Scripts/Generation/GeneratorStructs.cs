using UnityEngine;


[System.Serializable]
public struct CityTileProperties
{
    public TileSettings tileSettings;
    [Range(0, 100)] public float probability;
}

[System.Serializable]
public struct CityBuildingProperties
{
    public CityBuilding cityBuilding;
    [Range(0, 100)] public float probability;
}