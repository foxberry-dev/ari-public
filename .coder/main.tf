terraform {
  required_providers {
    coder = {
      source  = "coder/coder"
      version = "2.20.0"
    }
    kubernetes = {
      source  = "hashicorp/kubernetes"
      version = "3.5.0"
    }
  }
}

provider "coder" {}
provider "kubernetes" {}

data "coder_workspace" "me" {}
data "coder_workspace_owner" "me" {}

module "workspace" {
  source       = "http://nexus-cache.nexus.svc.cluster.local:8084/repository/workspace-kit/0035bc05e5c1dafe622394db2d607443e6d39d9ec9807f2d5f04c301e2f86fc9.tar.gz?checksum=sha256:0035bc05e5c1dafe622394db2d607443e6d39d9ec9807f2d5f04c301e2f86fc9"
  image        = "registry.foxberry.dev/foxberry/workspace-kit@sha256:d2abeb7c77727d6b8ec70e9571f228933ab226cbce8dd3b4e21007ae3e036af6"
  runner_image = "registry.foxberry.dev/foxberry/paperclip@sha256:636530bf3f757d74ea1574ccfa5b76350431f2acd4df2b1a41255c3343824907"
  apps         = { web = 5175 }
  project = {
    name       = "ari"
    repository = "https://github.com/foxberry-dev/ari.git"
    pre_push   = "sh .githooks/pre-push"
    startup    = file("${path.module}/startup.sh")
    dev = {
      install = "bash .coder/startup.sh"
      start   = "bash .coder/dev.sh"
      health  = "http://127.0.0.1:5175/api/health"
    }
    env        = {
      ARI_DEV_HOST = "web--main--${data.coder_workspace.me.name}--${data.coder_workspace_owner.me.name}.coder.foxberry.dev"
    }
  }
}
