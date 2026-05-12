(function() {
  var config = window.GUIA_FIREBASE_CONFIG || {};
  var collections = window.GUIA_FIREBASE_COLLECTIONS || {};
  var requiredKeys = ["apiKey", "authDomain", "projectId", "appId"];
  var configured = requiredKeys.every(function(key) {
    var value = config[key];
    return value && String(value).indexOf("COLE_AQUI") === -1;
  });

  var bridge = {
    isConfigured: function() {
      return configured;
    },
    getConfigError: function() {
      return "Firebase ainda nao foi configurado. Preencha o arquivo firebase-config.js.";
    }
  };

  if (!configured || !window.firebase) {
    window.guiaFirebase = bridge;
    return;
  }

  var app = firebase.apps && firebase.apps.length ? firebase.app() : firebase.initializeApp(config);
  var auth = app.auth();
  var db = app.firestore();

  function nowServer() {
    return firebase.firestore.FieldValue.serverTimestamp();
  }

  function normalizeSnapshot(doc) {
    var data = doc.data() || {};
    data.id = doc.id;
    return data;
  }

  function ensureConfigured() {
    if (!configured) {
      throw new Error(bridge.getConfigError());
    }
  }

  function mapEmpresa(doc, fallbackEmail) {
    var data = doc ? normalizeSnapshot(doc) : {};
    if (fallbackEmail && !data.email) {
      data.email = fallbackEmail;
    }
    return data;
  }

  function buscarEmpresaPorUid(uid, emailFallback) {
    return db.collection(collections.empresas).doc(uid).get().then(function(doc) {
      if (doc.exists) {
        return mapEmpresa(doc, emailFallback);
      }

      return db.collection(collections.empresas)
        .where("email", "==", emailFallback || "")
        .limit(1)
        .get()
        .then(function(snapshot) {
          if (snapshot.empty) {
            return null;
          }

          return mapEmpresa(snapshot.docs[0], emailFallback);
        });
    });
  }

  bridge.carregarEmpresasAprovadas = function() {
    ensureConfigured();

    return db.collection(collections.empresas)
      .where("aprovado", "==", true)
      .get()
      .then(function(snapshot) {
        var lista = snapshot.docs.map(normalizeSnapshot);
        lista.sort(function(a, b) {
          if (!!a.premium !== !!b.premium) {
            return a.premium ? -1 : 1;
          }

          var nomeA = (a.nome || "").toLowerCase();
          var nomeB = (b.nome || "").toLowerCase();
          return nomeA.localeCompare(nomeB);
        });
        return lista;
      });
  };

  bridge.registrarEmpresa = function(dados, senha) {
    ensureConfigured();

    return auth.createUserWithEmailAndPassword(dados.email, senha)
      .then(function(cred) {
        var payload = Object.assign({}, dados, {
          authUid: cred.user.uid,
          createdAt: nowServer(),
          atualizadoEm: nowServer()
        });

        delete payload.senha;

        return db.collection(collections.empresas).doc(cred.user.uid).set(payload).then(function() {
          return auth.signOut().then(function() {
            return { id: cred.user.uid };
          });
        });
      });
  };

  bridge.registrarUsuario = function(dados) {
    ensureConfigured();

    var payload = Object.assign({}, dados, {
      createdAt: nowServer(),
      atualizadoEm: nowServer()
    });

    return db.collection(collections.usuarios).add(payload);
  };

  bridge.registrarInteressePlano = function(dados) {
    ensureConfigured();

    var payload = Object.assign({}, dados, {
      createdAt: nowServer(),
      atualizadoEm: nowServer()
    });

    return db.collection(collections.interessesPlanos).add(payload);
  };

  bridge.registrarCandidatura = function(dados) {
    ensureConfigured();

    var payload = Object.assign({}, dados, {
      createdAt: nowServer(),
      atualizadoEm: nowServer()
    });

    return db.collection(collections.candidaturas).add(payload);
  };

  bridge.signInEmpresa = function(email, senha, lembrar) {
    ensureConfigured();

    var persistence = lembrar
      ? firebase.auth.Auth.Persistence.LOCAL
      : firebase.auth.Auth.Persistence.SESSION;

    return auth.setPersistence(persistence)
      .then(function() {
        return auth.signInWithEmailAndPassword(email, senha);
      })
      .then(function(cred) {
        return buscarEmpresaPorUid(cred.user.uid, cred.user.email || email).then(function(empresa) {
          if (!empresa) {
            return auth.signOut().then(function() {
              var error = new Error("Empresa nao encontrada.");
              error.code = "empresa/not-found";
              throw error;
            });
          }

          if (!empresa.aprovado) {
            return auth.signOut().then(function() {
              var error = new Error("Empresa ainda nao aprovada.");
              error.code = "empresa/not-approved";
              throw error;
            });
          }

          return empresa;
        });
      });
  };

  bridge.getEmpresaAtual = function() {
    ensureConfigured();

    if (!auth.currentUser) {
      return Promise.resolve(null);
    }

    return buscarEmpresaPorUid(auth.currentUser.uid, auth.currentUser.email);
  };

  bridge.observarEmpresaLogada = function(callback) {
    ensureConfigured();

    return auth.onAuthStateChanged(function(user) {
      if (!user) {
        callback(null, null);
        return;
      }

      buscarEmpresaPorUid(user.uid, user.email)
        .then(function(empresa) {
          callback(empresa, user);
        })
        .catch(function(error) {
          callback(null, user, error);
        });
    });
  };

  bridge.signOutEmpresa = function() {
    ensureConfigured();
    return auth.signOut();
  };

  window.guiaFirebase = bridge;
})();
