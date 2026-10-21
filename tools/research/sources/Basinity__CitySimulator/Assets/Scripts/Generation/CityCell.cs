using UnityEngine;

namespace Generation
{
    public class CityCell : MonoBehaviour
    {
        public bool collapsed;
        public TileSettings[] possibleTiles;
        public Vector2Int position;
    }
}