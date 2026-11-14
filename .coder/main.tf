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
  source       = "http://nexus-cache.nexus.svc.cluster.local:8084/repository/workspace-kit/8c8987bd87dd6a60cc8bf3741e88358eb05e44ec05dc879b179e5c874db87644.tar.gz?checksum=sha256:8c8987bd87dd6a60cc8bf3741e88358eb05e44ec05dc879b179e5c874db87644"
  image        = "registry.foxberry.dev/foxberry/workspace-kit@sha256:30c60fda96de9a1d09d51e5c43779ab1cbf9d09e40fc3c23e240e5b92934ab02"
  runner_image = "registry.foxberry.dev/foxberry/paperclip@sha256:636530bf3f757d74ea1574ccfa5b76350431f2acd4df2b1a41255c3343824907"
  apps         = { web = 5175 }
  project = {
    name       = "ari"
    repository = "https://github.com/foxberry-dev/ari.git"
    pre_push   = "sh .githooks/pre-push"
    startup    = file("${path.module}/startup.sh")
    env        = {
      ARI_DEV_HOST = "web--main--${data.coder_workspace.me.name}--${data.coder_workspace_owner.me.name}.coder.foxberry.dev"
    }
  }
}
