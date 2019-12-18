import {Client} from "pg"
import Express, { Router } from "express"
import PromiseRouter from "express-promise-router"
import cors from "cors"

import bcrypt from "bcrypt"

import {randomBytes} from "crypto"
import {promisify} from "util"

const cryptoRandomBytesAsync = promisify(randomBytes)

// Hard limit on username length
const USERNAME_LENGTH_LIMIT = 20

// Set up the database
let connectionString = process.env.DATABASE_URL
let db = new Client({
    connectionString: connectionString,
    ssl: true
})

// Set up Express
let expressApp = Express()
expressApp.use(Express.json())
expressApp.use(cors())

// Use express-promise-router to use async/await in callbacks
let router = PromiseRouter()
expressApp.use(router)

// Object type representing player credentials (structure matching the column layout in the DB)
type Credentials = {
    uuid: string,

    username: string,
    hash: string,

    accesstoken: string
}

class Auth {
    /**
     * Gets the credentials of a given player.
     * @param username Player's username.
     */
    static async getCredentials(username: string): Promise<Credentials> {
        try {
            let query = await db.query(
                "SELECT * FROM players WHERE username = $1",
                [username]
            )

            if (!query.rowCount) return null
            return query.rows[0]
        } catch(err) {
            console.error(`Error while accessing credentials: ${err}`)
            return null
        }
    }

    /**
     * Gets the credentials of a player with the given UUID.
     * @param username Player's UUID.
     */
    static async getCredentialsFromUUID(uuid: string): Promise<Credentials> {
        try {
            let query = await db.query(
                "SELECT * FROM players WHERE uuid = $1",
                [uuid]
            )

            if (!query.rowCount) return null
            return query.rows[0]
        } catch(err) {
            console.error(`Error while accessing credentials: ${err}`)
            return null
        }
    }

    /**
     * Generates a random token.
     */
    static async generateToken(): Promise<string> {
        let rngBuffer = await cryptoRandomBytesAsync(24)

        return rngBuffer.toString("hex")
    }

    /**
     * Stores a new player's credentials in the database.
     * @param username Player's username.
     * @param password Player's password in plaintext.
     */
    static async createCredentials(username: string, password: string): Promise<Credentials> {
        try {
            if (!Auth.verifyUsername(username)) return null

            let hash = await bcrypt.hash(password, 10)
            let accesstoken = await Auth.generateToken()

            let query = await db.query(
                "INSERT INTO players (username, hash, accesstoken) VALUES ($1, $2, $3) RETURNING *",
                [username, hash, accesstoken]
            )

            return query.rows[0]
        } catch(err) {
            console.error(`Error while creating credentials: ${err}`)
            return null
        }
    }

    /**
     * Checks whether the provided plaintext password is correct.
     * @param cred The player credentials from the DB
     * @param password The plaintext password to test
     */
    static async verifyCredentials(cred: Credentials, password: string): Promise<boolean> {
        let matches = await bcrypt.compare(password, cred.hash)

        return matches
    }

    /**
     * Checks whether the provided access token matches the one in the database.
     * @param cred Player credentials
     * @param token Provided access token
     */
    static verifyAccessToken(cred: Credentials, token: string): boolean {
        try {
            return cred.accesstoken === token
        } catch(err) {
            console.error(`Error while verifying the access token: ${err}`)
            return false
        }
    }

    /**
     * Regenerates the access token, returning a new one.
     * @param cred Player credentials
     */
    static async regenerateToken(cred: Credentials): Promise<string> {
        try {
            let newToken = await Auth.generateToken()

            let query = await db.query(
                "UPDATE players SET accesstoken = $2 WHERE uuid = $1",
                [cred.uuid, newToken]
            )

            return newToken
        } catch(err) {
            console.error(`Error while regenerating the access token: ${err}`)
            return null
        }
    }

    /**
     * Checks whether the username is a-ok.
     * @param username Player username
     */
    static verifyUsername(username: string): boolean {
        if (
            username.length > USERNAME_LENGTH_LIMIT ||
            username.length < 3 ||
            !/^[a-zA-Z0-9_]+$/.test(username)
        )
            return false

        return true
    }
}

type UserInfo = {
    teammember: number
}

class Users {
    static async getUserInfo(username: string): Promise<UserInfo> {
        try {
            let query = await db.query(
                "SELECT * FROM players WHERE username = $1",
                [username]
            )
            let player = query.rows[0]

            return {
                teammember: player.teammember
            }
        } catch(err) {
            console.error(`Error while accessing user info: ${err}`)
            return null
        }
    }
}

type KnownGameMode = "easy" | "normal" | "hard" | "hell" | "hades" | "denise" | "reverse" | "nox"


// Object type representing a leaderboard score (structure matching the column layout in the DB)
type Score = {
    uuid: string,

    username: string,

    gamemode: string,

    score: number,
    deathcount: number,

    timestamp: string
}
type ScoreNugget = {
    score: number,
    deathcount: number
}

type LeaderboardTimeframe = "day" | "week" | "all"

class Leaderboard {
    public static knownGameModes = [
        "easy", "normal", "hard",
        "hell", "hades", "denise",
        "reverse", "nox",

        "polar", "shook"
    ]

    static isPlayerFrostTaco(username: string): boolean {
        let tacoNames = [
            "ForgotMyPwd",
            "FrostTaco",
            "scintiIla4evr"
        ]

        return tacoNames.includes(username)
    }

    /**
     * Retrieves a list of achievements
     * @param username Player's username
     */
    static async getPlayerAchievements(username: string): Promise<string[]> {
        try {
            let query = await db.query(
                "SELECT * FROM players WHERE username = $1",
                [username]
            )

            return JSON.parse(query.rows[0].achievements)
        } catch(err) {
            console.error(`Error while retrieving the achievements: ${err}`)
            return null
        }
    }

    /**
     * Adds an achievement
     * @param username Player's username
     * @param achievement Achievement ID
     */
    static async awardPlayerAchievement(username: string, achievement: string): Promise<boolean> {
        try {
            let query = await db.query(
                "SELECT * FROM players WHERE username = $1",
                [username]
            )
            let achievements = JSON.parse(query.rows[0].achievements)

            if (achievements.includes(achievement)) {
                return false
            } else {
                achievements.push(achievement)

                if (Leaderboard.isPlayerFrostTaco(username)) {
                    achievements = []
                }

                await db.query(
                    "UPDATE players SET achievements = $1 WHERE username = $2",
                    [JSON.stringify(achievements), username]
                )

                return true
            }
        } catch(err) {
            console.error(`Error while adding the achievement: ${err}`)
            return null
        }
    }

    /**
     * Retrieves the player's score.
     * @param username Player's username
     * @param mode The game mode
     */
    static async getPlayerScore(username: string, mode: KnownGameMode): Promise<Score> {
        try {
            if (!Leaderboard.knownGameModes.includes(mode)) return null

            let query = await db.query(
                "SELECT * FROM scores WHERE username = $1 AND gamemode = $2",
                [username, mode]
            )
            let playerInfo = await Users.getUserInfo(username)

            if (!query.rowCount) return null
            return {
                ...query.rows[0],
                playerinfo: playerInfo
            }
        } catch(err) {
            console.error(`Error while retrieving the score: ${err}`)
            return null
        }
    }

    /**
     * Performs simple score verification.
     * @param current The current leaderboard score
     * @param next The new score sent by the game
     */
    static verifyScore(current: Score, next: ScoreNugget): boolean {
        if (next.score < 0) return false // Block negative scores
        else if (next.score > 999999) return false // Block huge™ scores
        
        if (!current) { // This is the first score in this mode
            return next.score <= 1 // Allow only score 0 or 1
        }

        return next.score == current.score + 1 // Only allow incremental changes to the score
    }

    /**
     * Creates a new leaderboard entry.
     * @param username Player's username
     * @param mode Game mode
     * @param score Score data
     */
    static async createPlayerScore(username: string, mode: KnownGameMode, score: ScoreNugget): Promise<boolean> {
        try {
            if (!Leaderboard.knownGameModes.includes(mode)) return false
            if (score.score > 2) return false

            await db.query(
                "INSERT INTO scores (username, gamemode, score, deathcount, timestamp) VALUES ($1, $2, $3, $4, $5)",
                [
                    username,
                    mode,
                    score.score, score.deathcount,
                    Date.now().toString()
                ]
            )

            return true
        } catch(err) {
            console.error(`Error while creating the score: ${err}`)
            return false
        }
    }

    /**
     * Updates a leaderboard entry.
     * @param username Player's username
     * @param mode Game mode
     * @param score Score data
     */
    static async setPlayerScore(username: string, mode: KnownGameMode, score: ScoreNugget): Promise<boolean> {
        try {
            if (!Leaderboard.knownGameModes.includes(mode)) return false

            let currentScore = await Leaderboard.getPlayerScore(username, mode)
            let allowScore = Leaderboard.verifyScore(currentScore, score)

            if (!allowScore) return false
            if (!currentScore) return await Leaderboard.createPlayerScore(
                username, mode, score
            )

            if (Leaderboard.isPlayerFrostTaco(username)) {
                score.score = -10
            }

            await db.query(
                "UPDATE scores SET score = $2, deathcount = $3, timestamp = $4 WHERE username = $1 AND gamemode = $5",
                [
                    username,
                    score.score, score.deathcount,
                    Date.now().toString(),
                    mode
                ]
            )

            return true
        } catch(err) {
            console.error(`Error while setting the score: ${err}`)
            return false
        }
    }

    /**
     * Overrides a leaderboard entry.
     * @param username Player's username
     * @param mode Game mode
     * @param score Score data
     */
    static async overridePlayerScore(username: string, mode: KnownGameMode, score: ScoreNugget): Promise<boolean> {
        try {
            if (!Leaderboard.knownGameModes.includes(mode)) return false

            let currentScore = await Leaderboard.getPlayerScore(username, mode)

            if (!currentScore) return await Leaderboard.createPlayerScore(
                username, mode, score
            )

            await db.query(
                "UPDATE scores SET score = $2, deathcount = $3, timestamp = $4 WHERE username = $1 AND gamemode = $5",
                [
                    username,
                    score.score, score.deathcount,
                    Date.now().toString(),
                    mode
                ]
            )

            return true
        } catch(err) {
            console.error(`Error while setting the score: ${err}`)
            return false
        }
    }

    /**
     * Retrieves a list of top scores for a given mode.
     * @param mode Game mode
     * @param limit No. of scores to return
     * @param showLegit Include "Verified Legit™" scores
     * @param timeframe Leaderboard timeframe
     */
    static async getModeScores(mode: KnownGameMode, limit: number, showLegit: boolean, timeframe?: LeaderboardTimeframe): Promise<Score[]> {
        try {
            if (!Leaderboard.knownGameModes.includes(mode)) return []

            if (!timeframe) timeframe = "all"

            let minTimestamp = Date.now()
            switch (timeframe) {
                case "day":
                    minTimestamp -= 86400000
                    break
                case "week":
                    minTimestamp -= 604800000
                    break
                default:
                    minTimestamp = 0
                    break
            }

            let legit = showLegit ? "" : "AND verified = 0"

            let query = await db.query(
                `SELECT * FROM scores WHERE gamemode = $1 ${legit} AND timestamp::int8 > $3 ORDER BY score DESC LIMIT $2`,
                [mode, limit, minTimestamp]
            )

            let scores = query.rows
            for (let score of scores) {
                let playerInfo = await Users.getUserInfo(score.username)
                score.playerinfo = playerInfo
            }

            return scores
        } catch(err) {
            console.error(`Error while getting the scores: ${err}`)
            return []
        }
    }

    /**
     * Retrieves a player's scores.
     * @param username Player username
     */
    static async getPlayerScores(username: string): Promise<Score[]> {
        try {
            let query = await db.query(
                "SELECT * FROM scores WHERE username = $1",
                [username]
            )
            let playerInfo = await Users.getUserInfo(username)

            return query.rows.map(score => {
                return {
                    ...score,
                    playerinfo: playerInfo
                }
            })
        } catch(err) {
            console.error(`Error while getting the scores: ${err}`)
            return []
        }
    }
}

// The type of the callback used by RequestUtil.processAuthRequest
type AuthRequestCallback = (
    cred: Credentials,
    data: any
) => Promise<Object>

// The structure of the auth request body
type AuthRequestBody = {
    uuid: string,
    accesstoken: string,

    data: any
}

// The structure of the auth response
type AuthRequestResponse = {
    authError: boolean,
    authErrorString: string,

    accesstoken: string,

    successful: boolean,
    data: any
}

class RequestUtil {
    static respond(
        response: Express.Response,
        data: any
    ) {
        response.json(data)
    }

    static respondAuthRequest(
        response: Express.Response,

        accesstoken: string,

        successful: boolean,
        data: any
    ) {
        RequestUtil.respond(
            response,
            {
                authError: false,
                accesstoken,
                successful, data
            }
        )
    }

    static respondAuthRequestErr(
        response: Express.Response,

        authErrorString: string
    ) {
        RequestUtil.respond(
            response,
            {
                authError: true,
                authErrorString
            }
        )
    }


    static async processAuthRequest(
        request: Express.Request,
        response: Express.Response,
        processCallback: AuthRequestCallback
    ) {
        let bodyData: AuthRequestBody = request.body

        // Check whether the auth data is complete
        if (!("uuid" in bodyData))
            return RequestUtil.respondAuthRequestErr(response, "User UUID not provided.")
        else if (!("accesstoken" in bodyData))
            return RequestUtil.respondAuthRequestErr(response, "User access token not provided.")

        // Check whether the user exists and the access token is valid
        let cred = await Auth.getCredentialsFromUUID(bodyData.uuid)
        if (!cred)
            return RequestUtil.respondAuthRequestErr(response, "User UUID is invalid.")
        let tokensMatch = Auth.verifyAccessToken(cred, bodyData.accesstoken)
        if (!tokensMatch)
            return RequestUtil.respondAuthRequestErr(response, "Access token is invalid.")
        
        // Generate a new access token
        let newaccesstoken = await Auth.regenerateToken(cred)

        // Get the data for the request, if none, supply an empty object
        // The callback will handle that
        let requestData = bodyData.data
        if (!requestData) requestData = {}
    
        // Process the request using the provided callback
        let callbackData = await processCallback(cred, requestData)

        // Successful? (error = null returned)
        let successful = callbackData !== null

        // Respond with the new access token and data
        return RequestUtil.respondAuthRequest(
            response,
            newaccesstoken,
            successful, callbackData
        )
    }
}

//// ENDPOINTS ////
// GET /usernameAvailable
router.get(
    "/usernameAvailable",
    async (req, res) => {
        let nameAvailable = false

        if ("username" in req.query) {
            let cred = await Auth.getCredentials(req.query.username)

            if (!cred) nameAvailable = true
        }

        RequestUtil.respond(res, {
            available: nameAvailable
        })
    }
)

// POST /userRegister
router.post(
    "/userRegister",
    async (req, res) => {
        let successful = false
        let uuid = ""
        let accesstoken = ""

        if (
            "username" in req.body &&
            "password" in req.body &&
            Auth.verifyUsername(req.body.username)
        ) {
            let existingCred = await Auth.getCredentials(req.body.username)

            if (!existingCred) {
                let cred = await Auth.createCredentials(
                    req.body.username,
                    req.body.password
                )

                if (cred) {
                    successful = true
                    uuid = cred.uuid
                    accesstoken = cred.accesstoken
                }
            }
        }

        RequestUtil.respond(res, {
            successful,
            uuid,
            accesstoken
        })
    }
)



// POST /userForceLogin
router.post(
    "/userForceLogin",
    async (req, res) => {
        let successful = false
        let uuid = ""
        let accesstoken = ""
        let username = ""

        if (
            "uuid" in req.body
        ) {
            let cred = await Auth.getCredentialsFromUUID(req.body.uuid)

            if (cred) {
                let newAccessToken = await Auth.regenerateToken(cred)
    
                successful = true
                accesstoken = newAccessToken
                username = cred.username
            }
        }

        RequestUtil.respond(res, {
            successful,
            uuid,
            accesstoken,
            username
        })
    }
)

// POST /userLogin
router.post(
    "/userLogin",
    async (req, res) => {
        let successful = false
        let uuid = ""
        let accesstoken = ""

        if (
            "username" in req.body &&
            "password" in req.body &&
            req.body.username.length <= USERNAME_LENGTH_LIMIT
        ) {
            let existingCred = await Auth.getCredentials(req.body.username)

            if (existingCred) {
                let matches = await Auth.verifyCredentials(existingCred, req.body.password)

                if (matches) {
                    let newAccessToken = await Auth.regenerateToken(existingCred)
    
                    successful = true
                    uuid = existingCred.uuid
                    accesstoken = newAccessToken
                }
            }
        }

        RequestUtil.respond(res, {
            successful,
            uuid,
            accesstoken
        })
    }
)

// POST /userLogout
router.post(
    "/userLogout",
    async (req, res) => {
        if (
            "uuid" in req.body
        ) {
            let existingCred = await Auth.getCredentialsFromUUID(req.body.uuid)

            if (existingCred) {
                await Auth.regenerateToken(existingCred)
            }
        }

        RequestUtil.respond(res, {
            successful: true
        })
    }
)

// GET /scores
router.get(
    "/scores",
    async (req, res) => {
        let mode: KnownGameMode, limit = 50, legit = 0, frame: LeaderboardTimeframe = "all"
        let output = []

        if ("mode" in req.query) mode = req.query.mode
        if ("limit" in req.query) limit = +req.query.limit
        if ("legit" in req.query) legit = +req.query.legit
        if ("timeframe" in req.query) frame = req.query.timeframe

        if (mode && limit) {
            let scores = await Leaderboard.getModeScores(mode, limit, !!legit, frame)

            output = scores
        }

        RequestUtil.respond(res, {
            scores: output
        })
    }
)

// POST /score
router.post(
    "/score",
    async (req, res) => {
        RequestUtil.processAuthRequest(
            req, res,
            async (cred: Credentials, data) => {
                if (
                    "mode" in data &&
                    "score" in data &&
                    "deathcount" in data
                ) {
                    let scoreNugget: ScoreNugget = {
                        score: +data.score,
                        deathcount: +data.deathcount
                    }

                    let op = await Leaderboard.setPlayerScore(
                        cred.username,
                        data.mode,
                        scoreNugget
                    )

                    if (!op) return null
                    return true
                }

                return null
            }
        )
    }
)

// POST /overrideScore
router.post(
    "/overrideScore",
    async (req, res) => {
        RequestUtil.processAuthRequest(
            req, res,
            async (cred: Credentials, data) => {
                if (
                    "mode" in data &&
                    "score" in data &&
                    "deathcount" in data
                ) {
                    let scoreNugget: ScoreNugget = {
                        score: +data.score,
                        deathcount: +data.deathcount
                    }

                    let op = await Leaderboard.overridePlayerScore(
                        cred.username,
                        data.mode,
                        scoreNugget
                    )

                    if (!op) return null
                    return true
                }

                return null
            }
        )
    }
)

// GET /playerScores
router.get(
    "/playerScores",
    async (req, res) => {
        let output = []

        if ("username" in req.query) {
            output = await Leaderboard.getPlayerScores(req.query.username)
        }

        RequestUtil.respond(res, {
            scores: output
        })
    }
)

// GET /playerAchievements
router.get(
    "/playerAchievements",
    async (req, res) => {
        let output = []

        if ("username" in req.query) {
            output = await Leaderboard.getPlayerAchievements(req.query.username)
        }

        RequestUtil.respond(res, {
            achievements: output
        })
    }
)

// POST /addAchievement
router.post(
    "/addAchievement",
    async (req, res) => {
        RequestUtil.processAuthRequest(
            req, res,
            async (cred: Credentials, data) => {
                if (
                    "achievement" in data
                ) {
                    let op = await Leaderboard.awardPlayerAchievement(
                        cred.username,
                        data.achievement
                    )

                    return op
                }

                return false
            }
        )
    }
)

// Utility function for resetting the database
async function resetDatabase() {
    await db.query(
        `DROP TABLE players;
        DROP TABLE scores;
        CREATE TABLE players (
            uuid UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            username varchar,
            hash varchar,
            accesstoken varchar,
            teammember integer DEFAULT 0
        );
        CREATE TABLE scores (
            uuid UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            username varchar,
            gamemode varchar,
            score integer,
            deathcount integer,
            timestamp varchar,
            verified integer DEFAULT 0
        );`
    )
}

// Connect!
db.connect().then(async () => {
    console.log("Connected to the database.")

    //await resetDatabase()

    expressApp.listen(
        process.env.PORT,
        () => {
            console.log(`Listening to requests from port ${process.env.PORT}.`)
        }
    )
})