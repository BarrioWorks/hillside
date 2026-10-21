using System.Collections.Generic;
using UnityEngine;

[CreateAssetMenu(menuName = "CityGenerator/GeneratorSettings")]
public class GeneratorSettings : ScriptableObject
{
    public string generatorSettingName;
    public int width;
    public int height;
    public TileSettings buildingTile;

    [NonReorderable] public List<TileSettings> tiles;
    [NonReorderable] public List<CityBuilding> buildings;
}