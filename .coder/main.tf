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

module "workspace" {
  source       = "http://nexus-cache.nexus.svc.cluster.local:8084/repository/workspace-kit/d18dbc50c333332eb986ec741337c19072a98e2c50d0c54342db26194ade4efb.tar.gz?checksum=sha256:d18dbc50c333332eb986ec741337c19072a98e2c50d0c54342db26194ade4efb"
  image        = "registry.foxberry.dev/foxberry/workspace-kit@sha256:75248274106ad435ae4f6bd85ca8bc0944f4c6abc9387249fd9396e2885f7223"
  runner_image = "registry.foxberry.dev/foxberry/paperclip@sha256:636530bf3f757d74ea1574ccfa5b76350431f2acd4df2b1a41255c3343824907"
  project = {
    name       = "ari"
    repository = "https://github.com/foxberry-dev/ari.git"
    pre_push   = "sh .githooks/pre-push"
    startup    = file("${path.module}/startup.sh")
  }
}
