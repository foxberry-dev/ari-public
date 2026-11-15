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
  source       = "http://nexus-cache.nexus.svc.cluster.local:8084/repository/workspace-kit/db77fa0209dcc1b7ee42c3917b312ec4ac08e65cd9046fc58f0d4979bc82b36a.tar.gz?checksum=sha256:db77fa0209dcc1b7ee42c3917b312ec4ac08e65cd9046fc58f0d4979bc82b36a"
  image        = "registry.foxberry.dev/foxberry/workspace-kit@sha256:cadc76edeaf53afb67d835da83a312724f77cd535539928e3a741c0a19272568"
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
