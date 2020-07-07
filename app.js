const express = require('express')
const bodyParser = require('body-parser')
const {HttpClient} = require('@actions/http-client')
const {ErrorHandler, AuthError, BadRequestError} = require('express-json-api-error-handler')

const basicAuth = (username = '', password = '', realm = 'protected') => (req, res, next) => {
  const b64auth = (req.headers.authorization || '').split(' ')[1] || ''
  const [reqUsername, reqPassword] = Buffer.from(b64auth, 'base64').toString().split(':')

  if (username === reqUsername && password === reqPassword) {
    return next()
  }

  res.set('WWW-Authenticate', `Basic realm="${realm}"`)
  next(new AuthError('Authentication required.'))
}

const createComment = async (http, params) => {
  const {repoToken, owner, repo, issueNumber, body} = params

  return http.postJson(
    `https://api.github.com/repos/${owner}/${repo}/issues/${issueNumber}/comments`,
    {body},
    {
      accept: 'application/vnd.github.v3+json',
      authorization: `token ${repoToken}`,
    },
  )
}

const checkToken = async (http, token) => {
  if (!token) {
    return false
  }

  if (token === process.env.GITHUB_TOKEN) {
    // Assume the use of this token is intentional
    return true
  }

  const response = await http.get(`https://api.github.com/`, {
    accept: 'application/vnd.github.v3+json',
    authorization: `token ${token}`,
  })

  if (response.message.header('X-OAuth-Scopes')) {
    // Temporary tokens do not return this header
    return false
  }

  return response.message.statusCode === 200
}

const app = express()

app.use((req, res, next) => {
  req.httpClient = new HttpClient('http-client-add-pr-comment-bot')
  next()
})
app.use(bodyParser.json())
app.use(basicAuth(process.env.WEBHOOK_SECRET))

app.post('/repos/:owner/:repo/issues/:issueNumber/comments', async (req, res, next) => {
  try {
    const isTokenValid = await checkToken(req.httpClient, req.header('temporary-github-token'))
    if (!isTokenValid) {
      throw new BadRequestError('must provide a valid temporary github token')
    }

    const response = await createComment(req.httpClient, {
      ...req.params,
      ...req.body,
      repoToken: process.env.GITHUB_TOKEN,
    })

    res.status(200).send(response).end()
  } catch (err) {
    next(err)
  }
})

// Must use last
const errorHandler = new ErrorHandler()
errorHandler.setErrorEventHandler((err) => console.log(err))
app.use(errorHandler.handle)

app.listen(process.env.PORT || 3000)
