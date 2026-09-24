(function() {
  var config = window.GUIA_FIREBASE_CONFIG || {};
  var collections = window.GUIA_FIREBASE_COLLECTIONS || {};
  var requiredKeys = ["apiKey", "authDomain", "projectId", "appId"];
  var configured = requiredKeys.every(function(key) {
    var value = config[key];
    return value && String(value).indexOf("COLE_AQUI") === -1;
  });
  var sdkAvailable = !!window.firebase;

  var bridge = {
    isConfigured: function() {
      return configured && sdkAvailable;
    },
    getConfigError: function() {
      if (!configured) {
        return "Firebase ainda nao foi configurado. Preencha o arquivo firebase-config.js.";
      }
      if (!sdkAvailable) {
        return "Firebase nao carregou. Verifique a conexao com a internet e tente atualizar a pagina.";
      }
      return "Firebase ainda nao foi configurado. Preencha o arquivo firebase-config.js.";
    }
  };

  if (!configured || !sdkAvailable) {
    window.guiaFirebase = bridge;
    return;
  }

  var app = firebase.apps && firebase.apps.length ? firebase.app() : firebase.initializeApp(config);
  var auth = app.auth();
  var db = app.firestore();
  var adminEmails = (window.GUIA_ADMIN_EMAILS || []).map(function(email) {
    return String(email || "").trim().toLowerCase();
  }).filter(Boolean);

  function nowServer() {
    return firebase.firestore.FieldValue.serverTimestamp();
  }

  function normalizeSnapshot(doc) {
    var data = doc.data() || {};
    data.id = doc.id;
    return data;
  }

  function ensureConfigured() {
    if (!configured || !sdkAvailable) {
      throw new Error(bridge.getConfigError());
    }
  }

  function isAdminEmail(email) {
    return !!email && adminEmails.indexOf(String(email).trim().toLowerCase()) > -1;
  }

  function normalizeEmail(email) {
    return String(email || "").trim().toLowerCase();
  }

  function limparCadastroAuthCriado(user, originalError) {
    var devolverErroOriginal = function() {
      return auth.signOut().catch(function() {}).then(function() {
        throw originalError;
      });
    };

    if (user && typeof user.delete === "function") {
      return user.delete().catch(function() {}).then(devolverErroOriginal);
    }

    return devolverErroOriginal();
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

  function buscarEmpresaDocRefPorUid(uid, emailFallback) {
    var docRef = db.collection(collections.empresas).doc(uid);

    return docRef.get().then(function(doc) {
      if (doc.exists) {
        return docRef;
      }

      return db.collection(collections.empresas)
        .where("email", "==", emailFallback || "")
        .limit(1)
        .get()
        .then(function(snapshot) {
          if (snapshot.empty) {
            return null;
          }

          return snapshot.docs[0].ref;
        });
    });
  }

  function mapUsuario(doc, fallbackEmail) {
    var data = doc ? normalizeSnapshot(doc) : {};
    if (fallbackEmail && !data.email) {
      data.email = fallbackEmail;
    }
    return data;
  }

  function buscarUsuarioPorUid(uid, emailFallback) {
    return db.collection(collections.usuarios).doc(uid).get().then(function(doc) {
      if (doc.exists) {
        return mapUsuario(doc, emailFallback);
      }

      return db.collection(collections.usuarios)
        .where("email", "==", emailFallback || "")
        .limit(1)
        .get()
        .then(function(snapshot) {
          if (snapshot.empty) {
            return null;
          }

          return mapUsuario(snapshot.docs[0], emailFallback);
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

  bridge.isAdminEmail = function(email) {
    return isAdminEmail(email);
  };

  bridge.registrarEmpresa = function(dados, senha) {
    ensureConfigured();

    var email = normalizeEmail(dados.email);

    return auth.createUserWithEmailAndPassword(email, senha)
      .then(function(cred) {
        var payload = Object.assign({}, dados, {
          email: email,
          authUid: cred.user.uid,
          aprovado: false,
          premium: false,
          createdAt: nowServer(),
          atualizadoEm: nowServer()
        });

        delete payload.senha;

        return db.collection(collections.empresas).doc(cred.user.uid).set(payload)
          .then(function() {
            return auth.signOut().then(function() {
              return { id: cred.user.uid };
            });
          })
          .catch(function(error) {
            return limparCadastroAuthCriado(cred.user, error);
          });
      });
  };

  bridge.registrarUsuario = function(dados) {
    ensureConfigured();

    var email = normalizeEmail(dados.email);

    return auth.createUserWithEmailAndPassword(email, dados.senha)
      .then(function(cred) {
        var payload = Object.assign({}, dados, {
          email: email,
          authUid: cred.user.uid,
          createdAt: nowServer(),
          atualizadoEm: nowServer()
        });

        delete payload.senha;
        delete payload.aprovado;

        return db.collection(collections.usuarios).doc(cred.user.uid).set(payload)
          .then(function() {
            return auth.signOut().then(function() {
              return { id: cred.user.uid };
            });
          })
          .catch(function(error) {
            return limparCadastroAuthCriado(cred.user, error);
          });
      });
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

  bridge.atualizarEmpresaAtual = function(dados) {
    ensureConfigured();

    if (!auth.currentUser) {
      return Promise.reject(new Error("Empresa nao autenticada."));
    }

    return buscarEmpresaDocRefPorUid(auth.currentUser.uid, auth.currentUser.email)
      .then(function(docRef) {
        if (!docRef) {
          var error = new Error("Empresa nao encontrada.");
          error.code = "empresa/not-found";
          throw error;
        }

        var payload = Object.assign({}, dados, {
          atualizadoEm: nowServer()
        });

        delete payload.senha;
        delete payload.email;
        delete payload.authUid;
        delete payload.aprovado;
        delete payload.premium;
        delete payload.plano;

        return docRef.set(payload, { merge: true });
      })
      .then(function() {
        return buscarEmpresaPorUid(auth.currentUser.uid, auth.currentUser.email);
      });
  };

  bridge.signInUsuario = function(email, senha, lembrar) {
    ensureConfigured();

    var persistence = lembrar
      ? firebase.auth.Auth.Persistence.LOCAL
      : firebase.auth.Auth.Persistence.SESSION;

    return auth.setPersistence(persistence)
      .then(function() {
        return auth.signInWithEmailAndPassword(email, senha);
      })
      .then(function(cred) {
        return buscarUsuarioPorUid(cred.user.uid, cred.user.email || email).then(function(usuario) {
          if (!usuario) {
            return auth.signOut().then(function() {
              var error = new Error("Usuario nao encontrado.");
              error.code = "usuario/not-found";
              throw error;
            });
          }

          return usuario;
        });
      });
  };

  bridge.getUsuarioAtual = function() {
    ensureConfigured();

    if (!auth.currentUser) {
      return Promise.resolve(null);
    }

    return buscarUsuarioPorUid(auth.currentUser.uid, auth.currentUser.email);
  };

  bridge.signInGestor = function(email, senha, lembrar) {
    ensureConfigured();

    var persistence = lembrar
      ? firebase.auth.Auth.Persistence.LOCAL
      : firebase.auth.Auth.Persistence.SESSION;

    return auth.setPersistence(persistence)
      .then(function() {
        return auth.signInWithEmailAndPassword(email, senha);
      })
      .then(function(cred) {
        var userEmail = cred.user && cred.user.email ? cred.user.email : email;
        if (!isAdminEmail(userEmail)) {
          return auth.signOut().then(function() {
            var error = new Error("Acesso de gestor nao autorizado.");
            error.code = "admin/not-allowed";
            throw error;
          });
        }

        return {
          uid: cred.user.uid,
          email: userEmail
        };
      });
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

  bridge.observarGestorLogado = function(callback) {
    ensureConfigured();

    return auth.onAuthStateChanged(function(user) {
      if (!user || !isAdminEmail(user.email)) {
        callback(null, user || null);
        return;
      }

      callback({
        uid: user.uid,
        email: user.email
      }, user);
    });
  };

  bridge.listarEmpresasGestor = function() {
    ensureConfigured();

    return db.collection(collections.empresas)
      .get()
      .then(function(snapshot) {
        var lista = snapshot.docs.map(normalizeSnapshot);
        lista.sort(function(a, b) {
          function stamp(item) {
            var value = item && item.createdAt;
            if (value && typeof value.toMillis === "function") {
              return value.toMillis();
            }
            if (value && typeof value.seconds === "number") {
              return value.seconds * 1000;
            }
            return 0;
          }
          return stamp(b) - stamp(a);
        });
        return lista;
      });
  };

  bridge.atualizarEmpresaGestor = function(empresaId, dados) {
    ensureConfigured();

    var camposPermitidos = ["aprovado", "premium", "plano"];
    var payload = {
      atualizadoEm: nowServer()
    };

    camposPermitidos.forEach(function(campo) {
      if (Object.prototype.hasOwnProperty.call(dados || {}, campo)) {
        payload[campo] = dados[campo];
      }
    });

    return db.collection(collections.empresas).doc(empresaId).set(payload, { merge: true });
  };

  bridge.signOutEmpresa = function() {
    ensureConfigured();
    return auth.signOut();
  };

  bridge.signOutUsuario = function() {
    ensureConfigured();
    return auth.signOut();
  };

  bridge.signOutGestor = function() {
    ensureConfigured();
    return auth.signOut();
  };

  window.guiaFirebase = bridge;
})();
