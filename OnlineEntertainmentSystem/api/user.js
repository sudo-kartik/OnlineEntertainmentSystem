const express = require("express");
const router = express.Router();
const User = require("../model/user.model");
const Tile = require("../model/tile.model");
const neo4j = require('neo4j-driver');
const redis = require("redis");
const redisClient = redis.createClient();



router.get('/', getUserFromRedis, getUserFromMongo);
router.get('/recommendations', getRecommendations);
router.get('/history', getuserViewingHistory);
router.post('/', addUser);
router.post('/addRelation', addRelation);
router.put('/',updateUser);



function addUser(req, res, next) {
    var user = new User(req.body);
    const driver = neo4j.driver("bolt://localhost:7687", neo4j.auth.basic("neo4j", "Anturkar@05"));
    const session = driver.session();
    user.save(function(err, user){
        if (err) {
            res.json(err); 
            return;
        }
        var id = user['_id'];
        
        const resultPromise = session.run('CREATE (u:USER {id:$id}) RETURN u',{id: String(id)});
        resultPromise.then(result => {
            session.close();
           
            let query = " ";
            req.body.preferedGeners.forEach(element => {
                query += "MERGE (:GENERE {name:'"+ element + "' }) "             
            })
            var generes = '[';
            req.body.preferedGeners.forEach((element, index, array) => {
                if(index === req.body.preferedGeners.length -1)
                    generes += "'" + element + "']";
                else
                    generes += "'" + element + "',";
            });
            var genereSession = driver.session()
    
            const generePromise = genereSession.run(query);
            generePromise.then(result => {
               
                genereSession.close();
                var relationQuery = "MATCH (u:USER), (g:GENERE) WHERE u.id = '" + String(id) + "' AND g.name IN " + generes + " CREATE (u)-[r:PREFERS]->(g) RETURN r";
                console.log(relationQuery);
                newSession = driver.session();
                const genereRelationPromise = newSession.run(relationQuery);
                genereRelationPromise.then(result => {
                   
                    newSession.close();
                    driver.close();
                    
                })
            });
            
            redisClient.set(user['email'], JSON.stringify(user), 'EX', 60 , function(err, reply) {
                res.json({"message":"User added successfuly", user});
              });
        });
    });
}
function getUserFromRedis(req, res, next ) {
    redisClient.get(req.query['email'], (err, reply) => {
        if(err) next();
        
        if(reply){ 
            res.status(200).json({"success": true, "user":JSON.parse(reply), "message": "Fetched from redis"});
            return;
        } else {
            next();
        }
    });
}
function getUserFromMongo(req, res, next) {
    User.findOne({email: req.query['email']}).exec((err, user) => {
        if(user){
            redisClient.set(user['email'], JSON.stringify(user), 'EX', 60 , function(err, reply) {
               
              });
            res.json({"success": true , "user":user,"message": "Fetched from mongodb"});
        } else{
            res.json({"success": false ,"message": "User not found"});
        }
    });
}

function addRelation(req, res, next) {
    const driver = neo4j.driver("bolt://localhost:7687", neo4j.auth.basic("neo4j", "Anturkar@05"));
    const session = driver.session();
    var email = req.body.email;
    var tile = req.body.tile;
    var like = req.body.like; 

    User.findOne({email: email}).exec((err, foundUser) => {  
        if(err) res.json({"success": false, "message" : err});      
        if(foundUser) {
            Tile.findOne({tile: tile}).exec((err, foundTile) =>  {
                if(err) res.json({"success": false, "message" : err});      
                if(foundTile) {
                    userId = foundUser['_id'];
                    tileId = foundTile['_id'];
                    
                    const resultPromise = session.run('MATCH (u:USER),(t:TILE) WHERE u.id = $userId AND t.id = $tileId CREATE (u)-[r:WATCHED {like:$like} ]->(t) RETURN r',{userId: String(userId), tileId: String(tileId), like: String(like)});
                    resultPromise.then(result => {
                        session.close();
                        driver.close();
                        res.json({"success": true, "message" : "Added relationship successfully"})
                    });
                } else {
                    res.json({"success": false, "message" : "No tile with name " + tile + " found"})
                }
            });
        } else {
            res.json({"success": false, "message" : "No user with email " + email + " found"});
        }
    });
    
    
}
function updateUser(req, res, next) {
    const driver = neo4j.driver("bolt://localhost:7687", neo4j.auth.basic("neo4j", "Anturkar@05"));
    const session = driver.session();
    if (req.body.email !== undefined) {
        let email = req.body.email;
        redisClient.get(email, function (err, reply) {
            if (reply) {
                redisClient.del(email , (err, result) => {
                     User.findByIdAndUpdate(JSON.parse(reply)['_id'], {$set: req.body}, {new:true}, (err, uUser) => {
                         if(err) res.json({success:false, message: err});
                         redisClient.set(email, JSON.stringify(uUser), 'EX' , 60 , (err, reply) => {
                             if (err) res.json({success:true, updated_tile: uUser, message: "User Updated Successfully. Cached data may not be updated."})
                             var query = "MATCH (u:USER)-[r:PREFERS]->(g:GENERE)  WHERE u.id = '" + String(uUser['id']) + "' DELETE r";
                             const updatedPromise = session.run(query, {id : String(uUser['id'])});
                             updatedPromise.then( result => {

                                 session.close();
                                 var generes = '[';
                                 uUser['preferedGeners'].forEach((element, index, array) => {
                                     if(index === uUser['preferedGeners'].length -1)
                                         generes += "'" + element + "']";
                                     else
                                         generes += "'" + element + "',";
                                 });

                                 var relationQuery = "MATCH (u:USER), (g:GENERE) WHERE u.id = '" + String(uUser['id']) + "' AND g.name IN " + generes + " CREATE (u)-[r:PREFERS]->(g) RETURN r";
                                 newSession = driver.session();
                                 const genereRelationPromise = newSession.run(relationQuery);
                                 genereRelationPromise.then(result => {

                                     newSession.close();
                                     driver.close();
                                     res.json({success:true, updated_user: uUser, message: "User Updated Successfully"});
                                 })
                             });

                         });
                     });
                });
            } else {
                User.findOne({email: email}).exec((err, result) => {
                    if (result) {
                        User.findByIdAndUpdate(result['_id'], {$set: req.body}, {new: true}, function(err, uUser) {
                            if(err) res.json({success:false, message: err});
                            console.log(uUser);
                            redisClient.set(uUser['email'], JSON.stringify(uUser), 'EX' , 60 ,() => {
                                if (err) res.json({success:true, updated_user: uUser, message: "User Updated Successfully. Cached data may not be updated."})
                                var query = "MATCH (u:USER)-[r:PREFERS]->(g:GENERE)  WHERE u.id = '" + String(uUser['id']) + "' DELETE r";
                                const updatedPromise = session.run(query, {id : String(uUser['id'])});
                                updatedPromise.then( result => {

                                    session.close();
                                    var generes = '[';
                                    uUser['preferedGeners'].forEach((element, index, array) => {
                                        if(index === uUser['preferedGeners'].length -1)
                                            generes += "'" + element + "']";
                                        else
                                            generes += "'" + element + "',";
                                    });

                                    var relationQuery = "MATCH (u:USER), (g:GENERE) WHERE u.id = '" + String(uUser['id']) + "' AND g.name IN " + generes + " CREATE (u)-[r:PREFERS]->(g) RETURN r";
                                    newSession = driver.session();
                                    const genereRelationPromise = newSession.run(relationQuery);
                                    genereRelationPromise.then(result => {

                                        newSession.close();
                                        driver.close();
                                        res.json({success:true, updated_user: uUser, message: "User Updated Successfully"});
                                    })
                                });
                            });
                        });
                    }
                });

            }
        })
    
    } else {
        req.json({success:false, message: "User email cannot be null"});
    }
       
}   
function getRecommendations(req, res, next) {
    const driver = neo4j.driver("bolt://localhost:7687", neo4j.auth.basic("neo4j", "Anturkar@05"));
    const session = driver.session();
    
    User.findOne({email: req.query['email']}).exec((err, user) => {
        if(user){
            
            query = "MATCH (u:USER)-[:PREFERS]->(genere:GENERE) " +
                    "WITH u, collect(genere.name) AS generes " +
                    "WHERE u.id = $id " + 
                    "MATCH (t:TILE)-[:BELONGS_TO]->(g:GENERE) " +
                    "WHERE g.name IN generes AND NOT (t)<-[:WATCHED]-(u)" +
                    "WITH t , (count(t) * 100) /  3  AS percentage_match " +
                    "RETURN t.tile AS tile, percentage_match " +
                    "ORDER BY percentage_match DESC " +
                    "LIMIT 5"
            console.log(query);
            const resultPromise = session.run(query,{id: String(user['_id'])});
            resultPromise.then(result => {
                session.close();
                driver.close();
                var recommendations = [];
                result.records.forEach(element => {
                   
                   var r = {};
                   r['tile'] = element._fields[0];
                   r['match_percentage'] = element._fields[1]['low'];
                   recommendations.push(r);
                });
                
                res.json({"success": true, "recommendations": recommendations,"message" : "recommendations fetched"})
            });
           
        } else{
            res.json({"success": false ,"message": "User not found"});
        }
    });
}
function getuserViewingHistory(req, res, next) {
    const driver = neo4j.driver("bolt://localhost:7687", neo4j.auth.basic("neo4j", "Anturkar@05"));
    const session = driver.session();
    email = req.query['email'];
    redisClient.get(email, (err, reply) => {
        if (reply){
            user = JSON.parse(reply);
            query = "MATCH (t:TILE)<-[r:WATCHED]-(u:USER) " +
                    "WHERE u.id = $id " +
                    "RETURN t.tile as tile, r.like as like";
            const resultPromise = session.run(query,{id: String(user['_id'])});
            resultPromise.then(result => {
                session.close();
                driver.close();
                var history = [];
                result.records.forEach(element => {
                   
                   var r = {};
                   r['tile'] = element._fields[0];
                   r['like'] = element._fields[1];
                   history.push(r);
                });
                
                res.json({"success": true, "history": history,"message" : "viewing history fetched"});
            });
        } else {
            User.findOne({email: req.query['email']}).exec((err, user) => {
                if(user){
                    query = "MATCH (t:TILE)<-[r:WATCHED]-(u:USER) " +
                    "WHERE u.id = $id " +
                    "RETURN t.tile as tile, r.like as like";
                    const resultPromise = session.run(query,{id: String(user['_id'])});
                    resultPromise.then(result => {
                        session.close();
                        driver.close();
                        var history = [];
                        result.records.forEach(element => {
                            var r = {};
                                r['tile'] = element._fields[0];
                                r['like'] = element._fields[1];
                                history.push(r);
                            });
                            
                            res.json({"success": true, "history": history,"message" : "viewing history fetched"});
                        });
                } else {
                    res.json({"success": false, "message" : "Unable to fetch user viewing history"});
                }
            });        
        }

    });

}
module.exports = router;

