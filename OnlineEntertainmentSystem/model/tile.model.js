const mongoose = require('mongoose');

const tileSchema = mongoose.Schema({
    tile:	{ type: String, require: true, unique: true },
    discription: { type : String},
    type: { type: String , enum: ['movie','series'] ,require: true},
    publishedOn: { type: Date},
    duration: {type: String},
    genere:	{type: [String]},
    // prevTile: {type: UUID}
});

const Tile = module.exports = mongoose.model('tile', tileSchema);

