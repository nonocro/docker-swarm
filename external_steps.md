# Étapes de déploiement réel

Tout ce qui ne peut pas être fait dans le code — à faire manuellement une fois.

---

## 1. GitHub — Créer et pousser le dépôt

```bash
# Sur ton PC, dans le dossier du projet
git remote add origin https://github.com/<TON_USERNAME>/swarm.git
git add .
git commit -m "initial commit"
git push -u origin main
```

---

## 2. VirtualBox — Préparer le réseau des VMs

Les deux VMs doivent se voir entre elles ET être joignables depuis ton PC.

Dans VirtualBox, pour **chaque VM** :
- `Settings → Network → Adapter 1` → **Bridged Adapter** (choisir ta carte réseau physique)

Démarre les VMs, puis récupère leurs IPs :
```bash
ip a  # sur chaque VM
```

Note les IPs — exemple utilisé dans ce guide :
- **VM1 (manager)** : `192.168.1.10`
- **VM2 (worker)** : `192.168.1.11`

---

## 3. VMs — Installer Docker (sur les deux VMs)

```bash
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER
# Se déconnecter/reconnecter pour que le groupe soit pris en compte
```

Vérifier :
```bash
docker version
```

---

## 4. VM1 (manager) — Initialiser le Swarm

```bash
docker swarm init --advertise-addr 192.168.1.10
```

La commande affiche un token de join. Copie-le, il ressemble à :
```
docker swarm join --token SWMTKN-1-xxxx 192.168.1.10:2377
```

---

## 5. VM2 (worker) — Rejoindre le Swarm

Colle la commande copiée à l'étape précédente :
```bash
docker swarm join --token SWMTKN-1-xxxx 192.168.1.10:2377
```

Vérifie sur le manager :
```bash
docker node ls
# Doit afficher 2 nœuds : 1 Leader + 1 Worker
```

---

## 6. VM1 (manager) — Créer un user deploy dédié pour le CI

```bash
sudo adduser deploy
sudo usermod -aG docker deploy
```

---

## 7. PC — Générer une clé SSH pour le CI

```bash
ssh-keygen -t ed25519 -C "github-actions" -f ./ci_key -N ""
# Génère : ci_key (privée) et ci_key.pub (publique)
```

Copier la clé publique sur le manager :
```bash
ssh-copy-id -i ./ci_key.pub deploy@192.168.1.10
# ou manuellement :
cat ci_key.pub | ssh deploy@192.168.1.10 "mkdir -p ~/.ssh && cat >> ~/.ssh/authorized_keys"
```

Tester la connexion :
```bash
ssh -i ./ci_key deploy@192.168.1.10 "docker node ls"
```

**Supprimer les clés locales après** (ne pas les commiter) :
```bash
rm ci_key ci_key.pub
```

---

## 8. GitHub Actions — Rendre le manager accessible

> **Problème** : GitHub Actions tourne sur des serveurs distants. Ils ne peuvent pas atteindre `192.168.1.10` (IP locale).

**Option A — Tailscale (recommandé, gratuit)**

Sur le manager :
```bash
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up
```

Tailscale donne au manager une IP publique stable (ex: `100.x.x.x`). Utilise cette IP comme `SWARM_HOST`.

Dans le workflow CI, ajouter un step avant le deploy :
```yaml
- uses: tailscale/github-action@v2
  with:
    authkey: ${{ secrets.TAILSCALE_AUTHKEY }}
```
Créer la clé sur tailscale.com → Settings → Keys.

**Option B — Redirection de port (si accès au routeur)**

Sur ton routeur : rediriger le port `22` externe vers `192.168.1.10:22`.
Utiliser l'IP publique de ta box comme `SWARM_HOST`.

---

## 9. GitHub — Ajouter les secrets

Sur GitHub : `Settings → Secrets and variables → Actions → New repository secret`

| Nom | Valeur |
|-----|--------|
| `SSH_PRIVATE_KEY` | Contenu de `ci_key` (clé privée, commence par `-----BEGIN`) |
| `SWARM_HOST` | IP Tailscale du manager (ex: `100.x.x.x`) ou IP publique |
| `TAILSCALE_AUTHKEY` | Clé Tailscale (si option A) |

---

## 10. GitHub — Rendre l'image GHCR publique

Après le premier push (le CI va build et push l'image) :

`GitHub → ton profil → Packages → swarm → Package settings → Change visibility → Public`

Sinon, configurer l'auth sur le manager pour pull les images privées :
```bash
echo "<GITHUB_TOKEN>" | docker login ghcr.io -u <USERNAME> --password-stdin
```

---

## 11. Déclencher le premier déploiement

```bash
git push origin main
```

Suivre le pipeline : `GitHub → Actions → CI`

Les jobs s'enchaînent : `test → build-push → deploy → smoke test`

---

## 12. Vérifier sur le manager

```bash
docker service ls
docker service ps swarm_api
curl http://localhost:3000/health
```

L'API est accessible sur `http://192.168.1.10:3000` depuis ton PC.
