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
  source       = "http://nexus-cache.nexus.svc.cluster.local:8084/repository/workspace-kit/1a294a75fe93460b06c4aef998a119905a516837ce15dce535dacb861ffd0374.tar.gz?checksum=sha256:1a294a75fe93460b06c4aef998a119905a516837ce15dce535dacb861ffd0374"
  image        = "registry.foxberry.dev/foxberry/workspace-kit@sha256:da4d7a7052962a5d62616d220cb9c44a39adda3386af0026207374ffcf4b694b"
  runner_image = "registry.foxberry.dev/foxberry/paperclip@sha256:636530bf3f757d74ea1574ccfa5b76350431f2acd4df2b1a41255c3343824907"
  apps         = { web = 5175 }
  project = {
    name       = "ari"
    repository = "https://github.com/foxberry-dev/ari.git"
    pre_push   = "sh .githooks/pre-push"
    startup    = file("${path.module}/startup.sh")
    dev = {
      install = "bash .coder/startup.sh"
      start   = "npm start"
      health  = "http://127.0.0.1:5175/api/health"
    }
    env        = {
      ARI_DEV_HOST = "web--main--${data.coder_workspace.me.name}--${data.coder_workspace_owner.me.name}.coder.foxberry.dev"
    }
  }
}
