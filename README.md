# Swarm - API Express

API REST minimaliste avec Express.js, conçue pour être déployée dans un cluster Docker Swarm.

## Prérequis

- Node.js 18+
- npm

## Installation

```bash
npm install
```

## Lancer le serveur

```bash
npm start
```

Le serveur écoute sur le port `3000`.

## Routes

| Méthode | Route | Réponse |
|---------|-------|---------|
| GET | `/` | `{ hostname: "..." }` |
| GET | `/health` | `{ status: "OK" }` |

## Tests

```bash
npm test
```

---

## Questions

### Comment récupérez-vous le hostname dans Node.js ?

On utilise le module natif `os` de Node.js :

```js
import { hostname } from "os";
console.log(hostname()); // ex: "my-container-abc123"
```

`hostname()` retourne le nom de la machine (ou du conteneur). Dans Docker Swarm, chaque réplique a un hostname différent, ce qui permet d'identifier quel conteneur a répondu à la requête.

### Quelle différence entre "listening on localhost" et "0.0.0.0" dans un conteneur ?

- **`localhost` (127.0.0.1)** : le serveur n'accepte que les connexions venant de la machine elle-même. Dans un conteneur, cela signifie que personne de l'extérieur ne peut y accéder.

- **`0.0.0.0`** : le serveur écoute sur **toutes les interfaces réseau** de la machine. Dans un conteneur, cela inclut l'interface réseau Docker, ce qui permet au trafic extérieur d'atteindre le serveur.

En résumé : dans un conteneur, il faut toujours écouter sur `0.0.0.0`, sinon le serveur est inaccessible depuis l'extérieur.

### Quels fichiers doivent absolument être ignorés ? Pourquoi ?

- **`node_modules`** : doit être reconstruit dans l'image via `npm ci` pour garantir des binaires compatibles avec l'OS du conteneur (Linux/Alpine). Copier le dossier local peut introduire des binaires incompatibles.
- **`.env`** : contient des secrets (mots de passe, tokens). Les inclure dans le build context risque de les exposer dans l'image Docker.
- **`.git`** : l'historique git est inutile dans l'image et peut être volumineux.
- **`*.test.js`** : les fichiers de test n'ont aucune utilité en production.

### Comment valider que votre image finale ne contient pas d'artefacts de dev ?

On peut inspecter le contenu de l'image avec :

```bash
docker run --rm <image> sh -c "ls node_modules | head -20"
```

Pour vérifier qu'aucune dépendance de dev n'est présente (ex: `supertest`) :

```bash
docker run --rm <image> sh -c "ls node_modules | grep supertest"
```

Si la commande ne retourne rien, la dépendance de dev est absente de l'image.

### Quelle stratégie de tags adoptez-vous : `latest`, SHA, semver ?

On utilise deux tags en parallèle :

- **`sha-<commit>`** : tag immuable basé sur le SHA du commit Git. Permet de savoir exactement quel code tourne dans le conteneur.
- **`latest`** : pointe toujours vers le dernier build. Pratique pour un environnement de dev, mais à éviter seul en prod.

On n'utilise pas semver ici car il n'y a pas de versioning sémantique défini sur le projet.

### Pourquoi un tag immuable est préférable pour un déploiement fiable ?

Un tag comme `latest` peut être écrasé à tout moment par un nouveau build. Si un nœud Swarm pull l'image à un moment différent des autres, il peut récupérer une version différente, ce qui crée des incohérences dans le cluster.

Un tag immuable comme `sha-abc123` pointe toujours vers la même image. On est sûr que tous les nœuds font tourner exactement le même code, et on peut rollback facilement vers un SHA précédent si besoin.

### Accès distant au manager Swarm depuis GitHub Actions

**Approche choisie : Docker context via SSH**

C'est l'option la plus simple : GitHub Actions se connecte au manager Swarm via SSH et parle à son Docker daemon en posant `DOCKER_HOST=ssh://...`. Aucune infrastructure supplémentaire n'est nécessaire.

**Pourquoi pas les autres ?**

- **TCP + TLS** : nécessite de générer et gérer des certificats, ouvrir un port (2376) sur le manager donc plus de surface d'attaque.
- **Bastion / tunnel** : infrastructure supplémentaire à maintenir.
- **VPN** : idem, un service de plus à opérer.

**Secrets à configurer dans GitHub Actions :**

| Secret | Valeur |
|---|---|
| `SSH_PRIVATE_KEY` | Clé privée SSH (la clé publique est autorisée sur le manager) |
| `SWARM_HOST` | IP ou hostname du manager Swarm |

**Préparer le manager :**

```bash
# Sur le manager, autoriser la clé publique du CI
echo "<clé publique>" >> ~/.ssh/authorized_keys
```

---

## Accès distant, Architecture & Sécurité

### Architecture

```
GitHub Actions runner
        |
        | SSH (port 22, clé privée)
        v
  Manager Swarm
        |
        | docker stack deploy
        v
   Service Swarm
```

Le runner initie la connexion vers le manager. Le manager n'a pas besoin d'atteindre GitHub.

### Mécanisme d'authentification

- Le runner utilise une **clé SSH privée** stockée dans les secrets GitHub (`SSH_PRIVATE_KEY`)
- La clé publique correspondante est ajoutée dans `~/.ssh/authorized_keys` sur le manager
- Docker parle au daemon via SSH avec `DOCKER_HOST=ssh://deploy@<host>` = aucun port Docker exposé

### Ports exposés

| Port | Protocole | Usage |
|------|-----------|-------|
| 22 | SSH | Accès CI au manager |
| 3000 | HTTP | API applicative (interne au cluster) |

Le port Docker (2376/2375) n'est **pas** exposé.

### Risques et mitigations

| Risque | Mitigation |
|--------|-----------|
| Clé SSH compromise | Révoquer la clé publique du manager (`authorized_keys`) + rotation immédiate du secret GitHub |
| Runner avec accès trop large | Créer un user `deploy` dédié avec droits limités au groupe `docker` uniquement |
| Exposition de secrets dans les logs | Ne jamais `echo` de secrets, utiliser les secrets GitHub Actions |

### Pourquoi exposer Docker en TCP sans TLS est dangereux ?

Le daemon Docker écoute sur un socket Unix local par défaut. Si on l'expose en TCP sans TLS (`-H tcp://0.0.0.0:2375`), n'importe qui pouvant atteindre ce port peut **contrôler entièrement Docker** : lancer des conteneurs, monter le système de fichiers de l'hôte, obtenir un accès root. C'est une vulnérabilité critique.

TLS résout le problème en authentifiant le client via un certificat, mais c'est plus complexe à gérer. SSH est plus simple et aussi sûr.

### Quelle différence entre "le runner atteint le manager" et "le manager atteint le runner" ?

- **Runner → Manager** (notre cas) : le CI initie la connexion SSH vers le manager. Le manager n'a pas besoin de connaître l'adresse du runner, et n'ouvre aucune connexion sortante. C'est le sens naturel et le plus sûr.

- **Manager → Runner** : le manager devrait connaître l'adresse du runner (qui change à chaque job) et initier une connexion vers lui. Cela nécessite que le runner soit accessible depuis l'extérieur, ce qui est rarement le cas et introduit une surface d'attaque inutile.

### Comment Swarm gère-t-il un rolling update ?

Swarm met à jour les répliques une par une (selon `parallelism`). Pour chaque réplique :

1. Il démarre le nouveau conteneur (`order: start-first` = avant d'arrêter l'ancien)
2. Il attend que le conteneur soit `healthy` (via le healthcheck)
3. Il arrête l'ancien conteneur
4. Il attend `delay` secondes avant de passer à la réplique suivante

Pendant tout l'update, les autres répliques continuent de servir le trafic donc pas de coupure.

### Que se passe-t-il si le healthcheck échoue pendant l'update ?

Si le nouveau conteneur ne passe pas `healthy` (healthcheck en échec après les `retries`), Swarm considère le déploiement comme raté et déclenche l'action définie par `failure_action`.

Dans notre config : `failure_action: rollback`, Swarm revient automatiquement à la version précédente de l'image, sans intervention manuelle.

### Comment éviter d'afficher des secrets dans les logs ?

- Stocker les secrets dans **GitHub Secrets** et les injecter via `${{ secrets.NOM }}`. GitHub Actions les masque automatiquement dans les logs (remplacé par `***`).
- Ne jamais les passer en argument de commande (visibles dans `ps aux`), préférer les variables d'environnement.
- Ne jamais faire `echo "${{ secrets.NOM }}"` dans un step.

### Comment valider automatiquement que le service est "UP" après deploy (smoke test) ?

On a deux niveaux de validation :

1. **Healthcheck Swarm** (dans `docker-stack.yml`) : `wget` sur `/health` toutes les 15s. Swarm surveille chaque conteneur et rollback si ça échoue.

2. **Smoke test CI** (dans `ci.yml`, step "Smoke test") : après le déploiement, le runner fait un `curl --fail` sur le manager :

```bash
curl --fail http://<SWARM_HOST>:3000/health
```

`--fail` retourne un exit code non-zero si la réponse HTTP est une erreur, ce qui fait échouer le job CI immédiatement.

---

## Tests fonctionnels & Observabilité

### G1. Tests fonctionnels

**Tests unitaires** (`npm test`) -> couvrent `GET /health` et `GET /` sans serveur démarré :

```bash
npm test
```

**Smoke test** (`smoke.sh`) > valide un service en cours d'exécution :

```bash
sh smoke.sh http://localhost:3000
# ou via npm :
npm run smoke
```

Le script vérifie que :
- `GET /health` répond 200 avec `"OK"`
- `GET /` répond 200 avec un champ `"hostname"`

Il échoue (`set -e`) dès qu'une vérification ne passe pas.

### G2. Observabilité minimale

**Convention de logs**

Chaque requête produit une ligne JSON sur stdout :

```json
{"ts":"2026-04-27T10:00:00.000Z","method":"GET","path":"/health","status":200,"ms":3,"host":"container-abc123"}
```

**Inspecter l'état du service Swarm**

```bash
# Liste des services et nombre de répliques running
docker service ls --filter name=swarm

# État de chaque tâche (quel nœud, quel état, erreur éventuelle)
docker service ps swarm_api

# Logs en temps réel de toutes les répliques
docker service logs -f swarm_api
```
