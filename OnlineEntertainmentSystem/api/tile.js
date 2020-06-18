const express = require("express");
const router = express.Router();
const Tile = require("../model/tile.model");
const neo4j = require('neo4j-driver');
const redis = require("redis");
const redisClient = redis.createClient();

router.post('/', addTile);
router.get('/', getTilesFromRedis, getTilesFromMongo);
router.get('/statistics', getStatistics);
router.put('/', updateTile)

function addTile(req, res, next) {
    var tile = new Tile(req.body);
    const driver = neo4j.driver("bolt://localhost:7687", neo4j.auth.basic("neo4j", "Anturkar@05"));
    const session = driver.session();
    tile.save(function(err, tile){
        if (err) {
            res.json(err); 
            return console.error(err);
        }
        var id = tile['_id'];      
        let query = " ";
       
        var generes = '[';
        req.body.genere.forEach((element, index, array) => {
            if(index === req.body.genere.length -1)
                generes += "'" + element + "']";
            else
                generes += "'" + element + "',";
        });
        
       
        newSession = driver.session();
        const resultPromise = newSession.run('CREATE (t:TILE {id:$id , tile:$tile}) RETURN t',{id: String(id), tile: tile['tile']});
        resultPromise.then(result => {
            newSession.close();
            req.body.genere.forEach(element => {
                query += "MERGE (:GENERE {name:'"+ element + "' }) "             
            })
            console.log(query);
            const generePromise = session.run(query);
            generePromise.then(result => {
                session.close();
                var relationQuery = "MATCH (t:TILE), (g:GENERE) WHERE t.id = '" + String(id) + "' AND g.name IN " + generes + " CREATE (t)-[r:BELONGS_TO ]->(g) RETURN r";
                console.log(relationQuery);
                newSession = driver.session();
                const genereRelationPromise = newSession.run(relationQuery);
                genereRelationPromise.then(result => {
                    console.log(result);
                    newSession.close();
                    driver.close();
                    
                })
            });
            redisClient.set(tile['tile'].toLowerCase(), JSON.stringify(tile), 'EX' , 60,function(err, reply) {
                res.json({"message":"Tile created successfuly", tile});
              });
        });
        

    });
}

function getTilesFromRedis(req, res, next){
    if (req.query['search'] == undefined ) res.json({"success": false, "message": "search string cannot be null"});
    if (req.query['cached'] === 'false') {
        next();
    } else {    
        search = req.query['search'] + "*";    
        redisClient.scan('0', 'MATCH', search.toLowerCase(), 'COUNT', '100',(err, reply) => {
                if(reply[1].length > 0 ) {
                    var tiles = [];
                    for (var i = 0; i < reply[1].length; i++) {
                        tiles.push(reply[1][i]);   
                    }    
                    redisClient.mget(tiles,(err2,reply2) => {
                        result = '[' + reply2 + ']';
                        tiles = JSON.parse(result);
                        res.json({"success": true, "tiles": tiles , "message": "Tiles fetched from redis"});

                    });

                } else {
                    next();
                }

            })
    }
}
function getTilesFromMongo(req, res, next){

    Tile.find({'tile': new RegExp(req.query['search'], 'i') }, (err, tiles) => {
        if(err) res.json({"success": false, "message": err});
        if(tiles.length > 0)
            res.json({"success": true, "tiles": tiles , "message": "Tiles fetched mongodb"});
        else
            res.json({"success": false, "message": "No tiles found"});
    });
}

function updateTile(req, res, next) {
    const driver = neo4j.driver("bolt://localhost:7687", neo4j.auth.basic("neo4j", "Anturkar@05"));
    const session = driver.session();
   if (req.body.tile !== undefined) {
    tile = req.body.tile;
    
    redisClient.get(tile.toLowerCase(), (err, reply) => {
        if(reply){
            redisClient.del(tile.toLowerCase(), (err, result) => {
                Tile.findByIdAndUpdate(JSON.parse(reply)['_id'], {$set: req.body}, {new: true}, function(err, uTile) {
                    if(err) res.json({success:false, message: err});
                     redisClient.set(uTile['tile'].toLowerCase(), JSON.stringify(uTile) , 'EX' , 60, (err, reply) => {
                        if (err) res.json({success:true, updated_tile: uTile, message: "Tile Updated Successfully. Cached data may not be updated."})
                        var query = "MATCH (t:TILE)-[r:BELONGS_TO]->(g:GENERE)  WHERE t.id = '" + String(uTile['id']) + "' DELETE r";
                        console.log(query);
                        const updatedPromise = session.run(query, {id : String(uTile['id'])});
                        updatedPromise.then( result => {
                            
                            session.close();
                            var generes = '[';
                            uTile['genere'].forEach((element, index, array) => {
                                if(index === uTile['genere'].length -1)
                                    generes += "'" + element + "']";
                                else
                                    generes += "'" + element + "',";
                            });
                            
                            var relationQuery = "MATCH (t:TILE), (g:GENERE) WHERE t.id = '" + String(uTile['id']) + "' AND g.name IN " + generes + " CREATE (t)-[r:BELONGS_TO]->(g) RETURN r";
                            newSession = driver.session();
                            const genereRelationPromise = newSession.run(relationQuery);
                            genereRelationPromise.then(result => {
                                ;
                                newSession.close();
                                driver.close();
                                res.json({success:true, updated_tile: uTile, message: "Tile Updated Successfully"});        
                            })
                        });

                        
                    }); 
                });
            });
            
        } else {
            Tile.findOne({tile: tile}).exec((err, tileUpdate) => {
                if (tileUpdate) {
                    Tile.findByIdAndUpdate(tileUpdate['_id'], {$set: req.body}, {new: true}, function(err, uTile) {
                        if(err) res.json({success:false, message: err});
                        redisClient.set(uTile['tile'].toLowerCase(), JSON.stringify(uTile), 'EX' , 60 ,() => {
                            if (err) res.json({success:true, updated_tile: uTile, message: "Tile Updated Successfully. Cached data may not be updated."})
                            var query = "MATCH (t:TILE)-[r:BELONGS_TO]->(g:GENERE)  WHERE t.id = '" + String(uTile['id']) + "' DELETE r";
                            
                            const updatedPromise = session.run(query, {id : String(uTile['id'])});
                            updatedPromise.then( result => {
                                
                                session.close();
                                var generes = '[';
                                uTile['genere'].forEach((element, index, array) => {
                                    if(index === uTile['genere'].length -1)
                                        generes += "'" + element + "']";
                                    else
                                        generes += "'" + element + "',";
                                });
                                var relationQuery = "MATCH (t:TILE), (g:GENERE) WHERE t.id = '" + String(uTile['id']) + "' AND g.name IN " + generes + " CREATE (t)-[r:BELONGS_TO ]->(g) RETURN r";
                                newSession = driver.session();
                                const genereRelationPromise = newSession.run(relationQuery);
                                genereRelationPromise.then(result => {
                                    newSession.close();
                                    driver.close();
                                    res.json({success:true, updated_tile: uTile, message: "Tile Updated Successfully"});        
                                })
                            });
                        });
                    });
                }
            });
        }
    });
   } else {
       res.json({success:false, message:"Tile name cannot be undefined"});
   }
}
function getStatistics(req, res, next) {
    like = req.query['like'];
    var order = 'DESC';
    var limit = 5;
    console.log(req.query['desc']);
    if (req.query['order'] !== undefined) {
       
        order = req.query['order'];
    }
    
    
    if (req.query['limit'] !== undefined){
        limit = req.query['limit'];
    }
    const driver = neo4j.driver("bolt://localhost:7687", neo4j.auth.basic("neo4j", "Anturkar@05"));
    session = driver.session();
    if (like === undefined){
        query = "MATCH (t:TILE)<-[:WATCHED]-(u:USER) " +
                "WITH count(t) as total, t " +
                "ORDER BY total  " + order + " " +
                "RETURN t.tile as tile, total " +
                "LIMIT " + limit;
    } else {
        query = "MATCH (t:TILE)<-[:WATCHED{like: '"+ like+ "' }]-(u:USER) " +
                "WITH count(t) as total, t " +
                "ORDER BY total " + order + " " +
                "RETURN t.tile as tile, total " +
                "LIMIT " + limit;
    }
    
    const generePromise = session.run(query);
    generePromise.then(result => { 
        session.close();
        driver.close();
        var history = [];
        
        result.records.forEach(element => {
            var r = {};
                r['tile'] = element._fields[0];
                r['total'] = element._fields[1]['low'];
                history.push(r);
            });
            
        res.json({"success": true, "statistics": history,"message" : "Statistics fetched"});
    });

}
    
module.exports = router; 
