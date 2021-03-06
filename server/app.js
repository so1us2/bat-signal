module.exports = {
  init
}

const compress = require('compression')
const express = require('express')
const http = require('http')
const LoginTwitter = require('login-with-twitter')
const path = require('path')
const session = require('express-session')
const url = require('url')

const config = require('../config')
const secret = require('../secret')
const pushServer = require('./server')

const twitterCallbackUrl = `${config.httpOrigin}/auth/twitter/callback`
const loginTwitter = new LoginTwitter(Object.assign({
  callbackUrl: twitterCallbackUrl
}, secret.twitter))

function init (server, sessionStore) {
  const app = express()

  // Trust the nginx reverse proxy
  app.set('trust proxy', true)

  app.use(compress())

  // Add headers
  app.use((req, res, next) => {
    // Prevents IE and Chrome from MIME-sniffing a response to reduce exposure to
    // drive-by download attacks when serving user uploaded content.
    res.header('X-Content-Type-Options', 'nosniff')

    // Prevent rendering of site within a frame
    res.header('X-Frame-Options', 'DENY')

    // Enable the XSS filter built into most recent web browsers. It's usually
    // enabled by default anyway, so role of this headers is to re-enable for this
    // particular website if it was disabled by the user.
    res.header('X-XSS-Protection', '1; mode=block')

    next()
  })

  app.use(session({
    store: sessionStore,
    secret: secret.cookie,
    resave: false,
    saveUninitialized: false,
    cookie: {
      maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
      secure: 'auto'
    }
  }))

  app.use((req, res, next) => {
    const userName = req.session.user ? req.session.user.userName : ''
    res.cookie('userName', userName)
    next()
  })

  app.use(express.static(path.join(config.root, 'static')))
  app.use(express.static(path.dirname(require.resolve('tachyons'))))

  app.get('/auth/twitter', (req, res, next) => {
    if (req.session.user) {
      // Redirect logged-in users to the homepage
      return res.redirect('/')
    }

    loginTwitter.login((err, tokenSecret, url) => {
      if (err) return next(err)

      // Save token secret in the session object
      req.session.tokenSecret = tokenSecret

      // Redirect to Twitter authorization page
      res.redirect(url)
    })
  })

  app.get('/auth/twitter/callback', (req, res, next) => {
    if (req.session.user) {
      // Redirect logged-in users to the homepage
      return res.redirect('/')
    }

    const {oauth_token, oauth_verifier} = req.query
    loginTwitter.callback({oauth_token, oauth_verifier}, req.session.tokenSecret, (err, user) => {
      if (err) return next(err)

      // Delete the saved token secret
      delete req.session.tokenSecret

      // Save the user object in the session object
      req.session.user = user

      // Redirect user to the homepage
      res.redirect('/')
    })
  })

  app.get('/auth/twitter/logout', (req, res) => {
    // Delete the user object from the session
    delete req.session.user

    // Redirect the user to the homepage
    res.redirect('/')
  })

  app.get('/500', (req, res, next) => {
    next(new Error('Manually visited /500'))
  })

  app.get('/api/signals', (req, res) => {
    const {user} = req.session
    if (!user) return res.status(403).end()
    return res.json([
      {
        id: 1234,
        name: 'dc\'s first signal',
        stats: {
          subscribers: 0,
          alerts: 0
        }
      },
      {
        id: 1234,
        name: 'yimby sf',
        stats: {
          subscribers: 123,
          alerts: 77
        }
      }
    ])
  })

  app.get('*', (req, res) => {
    res.locals.state.error = `404: ${http.STATUS_CODES[404]}`
    res.status(404).end()
  })

  // TODO
  pushServer.init(app)

  app.use((err, req, res, next) => {
    console.error(err.stack || err.message)
    const code = err.status || 500
    res.locals.state.error = `${code}: ${http.STATUS_CODES[code]} (${err.message})`
    res.status(code).end()
  })

  server.on('request', app)
}
