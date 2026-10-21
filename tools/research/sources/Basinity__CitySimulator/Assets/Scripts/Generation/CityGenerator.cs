using System.Collections;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using Generation;
using StateMachine;
using UnityEngine;
using UnityEditor.AI;
using Utility;
using Random = UnityEngine.Random;

public class CityGenerator : Singleton<CityGenerator>
{
    private GeneratorSettings generatorSettings;
    [SerializeField] private CityCell cellPrefab;
    [SerializeField] private bool leftMouseToRedraw;
    [SerializeField] private bool spawnBuildings;
    [SerializeField, Range(0, 100)] private float spawnBuildingProbability;

    private CityCell[,] map;
    private int iterations;

    private void Awake()
    {
        DrawMap();
    }

    private void Update()
    {
        if (Input.GetMouseButtonDown(0) && leftMouseToRedraw)
        {
            #if UNITY_STANDALONE
            DrawMap();
            #endif
        }
    }

    private void DrawMap()
    {
        generatorSettings = Resources.Load<GeneratorSettings>("GeneratorSettings");

        foreach (Transform child in transform) Destroy(child.gameObject);
        map = new CityCell[generatorSettings.width, generatorSettings.height];
        iterations = 0;
        
        for (var y = 0; y < generatorSettings.height; y++)
        {
            for (var x = 0; x < generatorSettings.width; x++)
            {
                var newCell = Instantiate(cellPrefab, new Vector3(x * 20, 0, y * 20), Quaternion.identity, transform);
                newCell.possibleTiles = generatorSettings.tiles.ToArray();
                newCell.position = new Vector2Int(x, y);
                map[x, y] = newCell;
            }
        }
        
        StartCoroutine(GetNextCell());
    }

    private IEnumerator GetNextCell()
    {
        var mapList = map.Cast<CityCell>().ToList();
        mapList.RemoveAll(c => c.collapsed);

        yield return new WaitForEndOfFrame();
        
        var cellToCollapse = GetCityCellWithLowestPossibilities(mapList);
        if (cellToCollapse.possibleTiles.Length > 0)
            CollapseCell(cellToCollapse);
        else
            ResetCell(cellToCollapse);
        
    }

    private void CollapseCell(CityCell cell)
    {
        cell.collapsed = true;

        var selectedTile = cell.possibleTiles[Random.Range(0, cell.possibleTiles.Length)];

        cell.possibleTiles = new[] { selectedTile };
        Instantiate(selectedTile.tile, cell.transform.position, Quaternion.identity, cell.transform);

        var cellNeighbours = new List<Vector2Int>
        {
            new(0, -1),
            new(-1, 0),
            new(0, 1),
            new(1, 0),
            new(0, -2),
            new(0, 2),
            new(-2, 0),
            new(2, 0),
            new(-1, -1),
            new(1, -1),
            new(-1, 1),
            new(1, 1)
        };
        
        foreach (var neighbour in cellNeighbours)
        {
            ThreadPool.QueueUserWorkItem(UpdateCell,new Vector2Int(cell.position.x + neighbour.x, cell.position.y + neighbour.y));
        }

        iterations++;
        if (iterations < generatorSettings.width * generatorSettings.height)
        {
            StartCoroutine(GetNextCell());
        }
        else
        {
            if (spawnBuildings) StartCoroutine(SpawnBuildings());
        }
    }

    private void ResetCell(CityCell cell)
    {
        var neighbours = new List<Vector2Int>
        {
            new(0, 0),
            new(0, -1),
            new(-1, 0),
            new(0, 1),
            new(1, 0),
        };

        foreach (var neighbour in neighbours)
        {
            var x = cell.position.x + neighbour.x;
            var y = cell.position.y + neighbour.y;
            if (y > generatorSettings.height - 1 || x > generatorSettings.width - 1 || y < 0 || x < 0) continue;
            var neighbourCell = map[x, y];
            if (neighbourCell.collapsed) iterations--;
            neighbourCell.collapsed = false;
            neighbourCell.possibleTiles = generatorSettings.tiles.ToArray();
            if (neighbourCell.transform.childCount > 0) Destroy(neighbourCell.transform.GetChild(0).gameObject);
            ThreadPool.QueueUserWorkItem(UpdateCell, cell.position);
        }
        
        StartCoroutine(GetNextCell());
    }

    private void UpdateCell(object pos)
    {
        var position = (Vector2Int)pos;
        var x = position.x;
        var y = position.y;
        var newMap = (CityCell[,])map.Clone();

        if (y > generatorSettings.height - 1 || x > generatorSettings.width - 1 || y < 0 || x < 0) return;

        if (map[x, y].collapsed)
        {
            newMap[x, y] = map[x, y];
            return;
        }

        var possibleTiles = newMap[x, y].possibleTiles.ToList();

        // Check Up
        if (y < generatorSettings.height - 1)
        {
            var validTiles = new List<TileSettings>();

            foreach (var possibleTile in map[x, y + 1].possibleTiles)
            {
                var valid = possibleTile.downNeighbours;
                foreach (var tile in valid) tile.tileSettings.probability = tile.probability;

                validTiles.AddRange(valid.Select(properties => properties.tileSettings).Except(validTiles));
            }

            CheckValidity(possibleTiles, validTiles);
        }

        // Check Right
        if (x < generatorSettings.width - 1)
        {
            var validTiles = new List<TileSettings>();

            foreach (var possibleTile in map[x + 1, y].possibleTiles)
            {
                var valid = possibleTile.leftNeighbours;
                foreach (var tile in valid) tile.tileSettings.probability = tile.probability;

                validTiles.AddRange(valid.Select(properties => properties.tileSettings).Except(validTiles));
            }

            CheckValidity(possibleTiles, validTiles);
        }

        // Check Down
        if (y > 0)
        {
            var validTiles = new List<TileSettings>();

            foreach (var possibleTile in map[x, y - 1].possibleTiles)
            {
                var valid = possibleTile.upNeighbours;
                foreach (var tile in valid) tile.tileSettings.probability = tile.probability;

                validTiles.AddRange(valid.Select(properties => properties.tileSettings).Except(validTiles));
            }

            CheckValidity(possibleTiles, validTiles);
        }

        // Check Left
        if (x > 0)
        {
            var validTiles = new List<TileSettings>();

            foreach (var possibleTile in map[x - 1, y].possibleTiles)
            {
                var valid = possibleTile.rightNeighbours;
                foreach (var tile in valid) tile.tileSettings.probability = tile.probability;

                validTiles.AddRange(valid.Select(properties => properties.tileSettings).Except(validTiles));
            }

            CheckValidity(possibleTiles, validTiles);
        }
        
        // TODO: CALCULATE PROBABILITIES
        
        newMap[x, y].possibleTiles = possibleTiles.ToArray();
        map = newMap;
    }

    private void CheckValidity(List<TileSettings> possibleTiles, List<TileSettings> validOption)
    {
        for (var x = possibleTiles.Count - 1; x >= 0; x--)
        {
            var element = possibleTiles[x];
            if (!validOption.Contains(element))
            {
                possibleTiles.RemoveAt(x);
            }
        }
    }

    private IEnumerator SpawnBuildings()
    {
        for (var y = 0; y < generatorSettings.height; y++)
        {
            for (var x = 0; x < generatorSettings.width; x++)
            {
                if (map[x, y].possibleTiles[0] != generatorSettings.buildingTile) continue;

                if (Random.Range(0, 100) < spawnBuildingProbability)
                    Instantiate(generatorSettings.buildings[Random.Range(0, generatorSettings.buildings.Count)], new Vector3(x * 20f, 0f, y * 20f), Quaternion.identity, map[x, y].transform);
            }
        }
        
        yield return new WaitForSeconds(1f);
        #if UNITY_EDITOR
        NavMeshBuilder.BuildNavMesh();
        StartCoroutine(AIManager.Instance.Initialize());
        #endif
    }
    
    private static CityCell GetCityCellWithLowestPossibilities(List<CityCell> list)
    {
        var min = list[0].possibleTiles.Length;
        var minIndex = 0;

        for (var i = 1; i < list.Count; ++i) {
            if (list[i].possibleTiles.Length < min) {
                min = list[i].possibleTiles.Length;
                minIndex = i;
            }
        }

        return list[minIndex];
    }
}