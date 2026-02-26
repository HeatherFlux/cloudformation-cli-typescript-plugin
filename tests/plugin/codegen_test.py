# pylint: disable=redefined-outer-name,protected-access
from __future__ import unicode_literals

import os
import sys
from subprocess import CalledProcessError
from unittest.mock import patch, sentinel
from uuid import uuid4
from zipfile import ZipFile

import pytest
from rpdk.core.exceptions import DownstreamError
from rpdk.core.project import Project
from rpdk.typescript.codegen import (
    SUPPORT_LIB_NAME,
    TypescriptLanguagePlugin,
    validate_no,
)

TYPE_NAME = "foo::bar::baz"


@pytest.fixture
def plugin():
    return TypescriptLanguagePlugin()


@pytest.fixture
def project(tmp_path: str):
    project = Project(root=tmp_path)

    patch_plugins = patch.dict(
        "rpdk.core.plugin_registry.PLUGIN_REGISTRY",
        {TypescriptLanguagePlugin.NAME: lambda: TypescriptLanguagePlugin},
        clear=True,
    )
    patch_wizard = patch(
        "rpdk.typescript.codegen.input_with_validation",
        autospec=True,
        side_effect=[False],
    )
    with patch_plugins, patch_wizard:
        current_path = os.path.abspath(__file__)
        lib_abspath = os.path.abspath(os.path.join(current_path, "..", "..", ".."))
        TypescriptLanguagePlugin.SUPPORT_LIB_URI = "file:" + lib_abspath
        project.init(TYPE_NAME, TypescriptLanguagePlugin.NAME)
    return project


@pytest.fixture
def project_use_docker(tmp_path: str):
    project_use_docker = Project(root=tmp_path)

    patch_plugins = patch.dict(
        "rpdk.core.plugin_registry.PLUGIN_REGISTRY",
        {TypescriptLanguagePlugin.NAME: lambda: TypescriptLanguagePlugin},
        clear=True,
    )
    with patch_plugins:
        current_path = os.path.abspath(__file__)
        lib_abspath = os.path.abspath(os.path.join(current_path, "..", "..", ".."))
        TypescriptLanguagePlugin.SUPPORT_LIB_URI = "file:" + lib_abspath
        project_use_docker.init(
            TYPE_NAME,
            TypescriptLanguagePlugin.NAME,
            settings={"use_docker": True, "no_docker": False},
        )
    return project_use_docker


@pytest.fixture
def project_no_docker(tmp_path: str):
    project_no_docker = Project(root=tmp_path)

    patch_plugins = patch.dict(
        "rpdk.core.plugin_registry.PLUGIN_REGISTRY",
        {TypescriptLanguagePlugin.NAME: lambda: TypescriptLanguagePlugin},
        clear=True,
    )
    with patch_plugins:
        current_path = os.path.abspath(__file__)
        lib_abspath = os.path.abspath(os.path.join(current_path, "..", "..", ".."))
        TypescriptLanguagePlugin.SUPPORT_LIB_URI = "file:" + lib_abspath
        project_no_docker.init(
            TYPE_NAME,
            TypescriptLanguagePlugin.NAME,
            settings={"use_docker": False, "no_docker": True},
        )
    return project_no_docker


@pytest.fixture
def project_both_true(tmp_path: str):
    project_both_true = Project(root=tmp_path)

    patch_plugins = patch.dict(
        "rpdk.core.plugin_registry.PLUGIN_REGISTRY",
        {TypescriptLanguagePlugin.NAME: lambda: TypescriptLanguagePlugin},
        clear=True,
    )
    with patch_plugins:
        current_path = os.path.abspath(__file__)
        lib_abspath = os.path.abspath(os.path.join(current_path, "..", "..", ".."))
        TypescriptLanguagePlugin.SUPPORT_LIB_URI = "file:" + lib_abspath
        project_both_true.init(
            TYPE_NAME,
            TypescriptLanguagePlugin.NAME,
            settings={"use_docker": True, "no_docker": True},
        )
    return project_both_true


def get_files_in_project(project: Project):
    return {
        str(child.relative_to(project.root)): child for child in project.root.rglob("*")
    }


@pytest.mark.parametrize(
    "value,result",
    [
        ("y", True),
        ("Y", True),
        ("yes", True),
        ("Yes", True),
        ("YES", True),
        ("asdf", True),
        ("no", False),
        ("No", False),
        ("No", False),
        ("n", False),
        ("N", False),
    ],
)
def test_validate_no(value: str, result: bool):
    assert validate_no(value) is result


def test__remove_build_artifacts_file_found(tmp_path: str):
    deps_path = tmp_path / "build"
    deps_path.mkdir()
    TypescriptLanguagePlugin._remove_build_artifacts(deps_path)


def test__remove_build_artifacts_file_not_found(tmp_path: str):
    deps_path = tmp_path / "build"
    with patch("rpdk.typescript.codegen.LOG", autospec=True) as mock_log:
        TypescriptLanguagePlugin._remove_build_artifacts(deps_path)

    mock_log.debug.assert_called_once()


@pytest.fixture
def project_no_docker_use_docker_values(
    request, project, project_use_docker, project_no_docker, project_both_true
):
    return [
        (project, True, False),
        (project_use_docker, False, True),
        (project_no_docker, True, False),
        (project_both_true, False, True),
    ][request.param]


@pytest.mark.parametrize(
    "project_no_docker_use_docker_values", [0, 1, 2, 3], indirect=True
)
def test_initialize(project_no_docker_use_docker_values):
    (
        project_value,
        no_docker_value,
        use_docker_value,
    ) = project_no_docker_use_docker_values
    lib_path = project_value._plugin._lib_path
    assert project_value.settings == {
        "protocolVersion": "2.0.0",
        "no_docker": no_docker_value,
        "use_docker": use_docker_value,
    }

    files = get_files_in_project(project_value)
    assert set(files) == {
        ".gitignore",
        ".npmrc",
        ".rpdk-config",
        "foo-bar-baz.json",
        "example_inputs",
        f"{os.path.join('example_inputs', 'inputs_1_create.json')}",
        f"{os.path.join('example_inputs', 'inputs_1_invalid.json')}",
        f"{os.path.join('example_inputs', 'inputs_1_update.json')}",
        "Makefile",
        "package.json",
        "README.md",
        "sam-tests",
        f"{os.path.join('sam-tests', 'create.json')}",
        "src",
        f"{os.path.join('src', 'handlers.ts')}",
        "template.yml",
        "tsconfig.json",
    }

    assert "node_modules" in files[".gitignore"].read_text()
    package_json = files["package.json"].read_text()
    assert SUPPORT_LIB_NAME in package_json
    assert lib_path in package_json

    readme = files["README.md"].read_text()
    assert project_value.type_name in readme
    assert SUPPORT_LIB_NAME in readme
    assert "handlers.ts" in readme
    assert "models.ts" in readme

    assert project_value.entrypoint in files["template.yml"].read_text()
    assert "BuildMethod: makefile" in files["template.yml"].read_text()


def test_generate(project: Project):
    project.load_schema()
    before = get_files_in_project(project)
    project.generate()
    after = get_files_in_project(project)
    files = after.keys() - before.keys() - {"resource-role.yaml"}

    assert files == {f"{os.path.join('src', 'models.ts')}"}


def test_package_local(project: Project):
    project.load_schema()
    project.generate()

    zip_path = project.root / "foo-bar-baz.zip"

    # pylint: disable=unexpected-keyword-arg
    # Mock _build so we don't need a real npm/sam installation; the test
    # focuses on zip layout, not on the build subprocess.
    with zip_path.open("wb") as f, ZipFile(
        f, mode="w", strict_timestamps=False
    ) as zip_file:
        with patch.object(TypescriptLanguagePlugin, "_build"):
            project._plugin.package(project, zip_file)

    with zip_path.open("rb") as f, ZipFile(
        f, mode="r", strict_timestamps=False
    ) as zip_file:
        assert sorted(zip_file.namelist()) == [
            "ResourceProvider.zip",
            "src/handlers.ts",
            "src/models.ts",
        ]


def test__build_called_process_error(plugin: TypescriptLanguagePlugin, tmp_path: str):
    executable_name = str(uuid4())
    plugin._build_command = executable_name

    patch_validate = patch.object(plugin, "_validate_build_prerequisites")
    with patch_validate, patch.object(
        TypescriptLanguagePlugin,
        "_make_build_command",
        wraps=TypescriptLanguagePlugin._make_build_command,
    ) as mock_cmd:
        with pytest.raises(DownstreamError) as excinfo:
            plugin._build(tmp_path)

    mock_cmd.assert_called_once_with(tmp_path, executable_name)

    assert isinstance(excinfo.value.__cause__, CalledProcessError)


def test__build_docker(plugin: TypescriptLanguagePlugin):
    plugin._use_docker = True

    patch_cmd = patch.object(
        TypescriptLanguagePlugin, "_make_build_command", return_value=""
    )
    patch_subprocess_run = patch(
        "rpdk.typescript.codegen.subprocess_run", autospec=True
    )
    # Bypass prerequisite checks — tested separately in test_validate_prerequisites_*
    patch_validate = patch.object(plugin, "_validate_build_prerequisites")
    with patch_cmd as mock_cmd, patch_subprocess_run as mock_subprocess_run:
        with patch_validate:
            plugin._build(sentinel.base_path)

    mock_cmd.assert_called_once_with(sentinel.base_path, None)
    if sys.platform == "win32":
        mock_subprocess_run.assert_called_once_with(
            [os.environ.get("comspec"), "/C", " --use-container TypeFunction"],
            check=True,
            cwd=sentinel.base_path,
            stderr=-1,
            stdout=-1,
            universal_newlines=True,
        )
    else:
        mock_subprocess_run.assert_called_once_with(
            [" --use-container TypeFunction"],
            check=True,
            cwd=sentinel.base_path,
            stderr=-1,
            stdout=-1,
            shell=True,
            universal_newlines=True,
        )


def test_init_settings_removes_legacy_use_docker_key():
    """Ensure the legacy 'useDocker' key is cleaned up from .rpdk-config settings."""
    plugin = TypescriptLanguagePlugin()
    settings = {"useDocker": True, "use_docker": True, "no_docker": False}

    class FakeProject:
        settings = {}

    project = FakeProject()
    project.settings = dict(settings)
    plugin._use_docker = True
    plugin._no_docker = False
    plugin._protocol_version = "2.0.0"
    plugin._init_settings(project)

    assert "useDocker" not in project.settings
    assert project.settings["use_docker"] is True


def test_support_lib_version_matches_package_json():
    """Ensure support-lib-version.txt and SUPPORT_LIB_VERSION match package.json.

    SUPPORT_LIB_VERSION is now read dynamically from
    ``python/rpdk/typescript/data/support-lib-version.txt``.  Updating that
    file is all that is needed when bumping the npm package version.
    """
    import json  # pylint: disable=import-outside-toplevel
    from pathlib import Path  # pylint: disable=import-outside-toplevel

    # pylint: disable-next=import-outside-toplevel
    from rpdk.typescript.codegen import SUPPORT_LIB_VERSION

    repo_root = Path(__file__).parent.parent.parent
    pkg = json.loads((repo_root / "package.json").read_text())
    expected = f"^{pkg['version']}"

    # Check the data file directly (it's the source of truth).
    version_file = (
        repo_root
        / "python"
        / "rpdk"
        / "typescript"
        / "data"
        / "support-lib-version.txt"
    )
    file_version = f"^{version_file.read_text().strip()}"
    assert file_version == expected, (
        f"support-lib-version.txt ({file_version!r}) does not match "
        f"package.json version ({pkg['version']!r}). "
        "Run: echo 'X.Y.Z' > python/rpdk/typescript/data/support-lib-version.txt"
    )

    # Check the runtime constant (derived from the data file).
    assert SUPPORT_LIB_VERSION == expected, (
        f"SUPPORT_LIB_VERSION ({SUPPORT_LIB_VERSION!r}) does not match "
        f"package.json version ({pkg['version']!r}). "
        "The constant should be read from support-lib-version.txt automatically."
    )


# ---------------------------------------------------------------------------
# PY-03 — prerequisite validation tests
# ---------------------------------------------------------------------------


def test_validate_prerequisites_npm_missing(plugin: TypescriptLanguagePlugin):
    """DownstreamError raised when npm is not on PATH."""
    with patch("rpdk.typescript.codegen.shutil.which", return_value=None):
        with pytest.raises(DownstreamError, match="npm is not installed"):
            plugin._validate_build_prerequisites()


def test_validate_prerequisites_node_missing(plugin: TypescriptLanguagePlugin):
    """DownstreamError raised when node is not on PATH."""

    def which_side_effect(cmd):
        return "/usr/bin/npm" if cmd == "npm" else None

    with patch("rpdk.typescript.codegen.shutil.which", side_effect=which_side_effect):
        with pytest.raises(DownstreamError, match="node is not installed"):
            plugin._validate_build_prerequisites()


def test_validate_prerequisites_node_too_old(plugin: TypescriptLanguagePlugin):
    """DownstreamError raised when node version is below the minimum (20)."""

    def which_side_effect(cmd):
        return f"/usr/bin/{cmd}" if cmd in ("npm", "node") else None

    with patch("rpdk.typescript.codegen.shutil.which", side_effect=which_side_effect):
        with patch(
            "rpdk.typescript.codegen.subprocess_run",
            return_value=type("CP", (), {"stdout": "v18.20.0\n", "returncode": 0})(),
        ):
            with pytest.raises(DownstreamError, match="Node.js >= 20 is required"):
                plugin._validate_build_prerequisites()


def test_validate_prerequisites_sam_missing_default_command(
    plugin: TypescriptLanguagePlugin,
):
    """DownstreamError raised when sam is missing and no custom buildCommand."""
    plugin._build_command = None  # use default command → sam required

    def which_side_effect(cmd):
        return f"/usr/bin/{cmd}" if cmd in ("npm", "node") else None

    with patch("rpdk.typescript.codegen.shutil.which", side_effect=which_side_effect):
        with patch(
            "rpdk.typescript.codegen.subprocess_run",
            return_value=type("CP", (), {"stdout": "v20.10.0\n", "returncode": 0})(),
        ):
            with pytest.raises(DownstreamError, match="AWS SAM CLI is not installed"):
                plugin._validate_build_prerequisites()


def test_validate_prerequisites_sam_not_required_with_custom_command(
    plugin: TypescriptLanguagePlugin,
):
    """No error raised for missing sam when a custom buildCommand is set."""
    plugin._build_command = "echo 'custom build'"  # custom → sam not required

    def which_side_effect(cmd):
        return f"/usr/bin/{cmd}" if cmd in ("npm", "node") else None

    with patch("rpdk.typescript.codegen.shutil.which", side_effect=which_side_effect):
        with patch(
            "rpdk.typescript.codegen.subprocess_run",
            return_value=type("CP", (), {"stdout": "v20.10.0\n", "returncode": 0})(),
        ):
            # Should not raise — custom buildCommand means sam is optional
            plugin._validate_build_prerequisites()


def test_validate_prerequisites_all_present(plugin: TypescriptLanguagePlugin):
    """No error raised when all prerequisites are available."""
    plugin._build_command = None

    with patch("rpdk.typescript.codegen.shutil.which", return_value="/usr/bin/tool"):
        with patch(
            "rpdk.typescript.codegen.subprocess_run",
            return_value=type("CP", (), {"stdout": "v20.10.0\n", "returncode": 0})(),
        ):
            plugin._validate_build_prerequisites()  # should not raise


def test__build_validates_prerequisites(plugin: TypescriptLanguagePlugin, tmp_path):
    """_build() calls _validate_build_prerequisites() before running subprocess."""
    with patch.object(
        plugin, "_validate_build_prerequisites"
    ) as mock_validate, patch.object(
        TypescriptLanguagePlugin,
        "_make_build_command",
        return_value="",
    ), patch(
        "rpdk.typescript.codegen.subprocess_run", autospec=True
    ):
        plugin._build(tmp_path)

    mock_validate.assert_called_once()


# ---------------------------------------------------------------------------
# Additional coverage tests
# ---------------------------------------------------------------------------


def test_load_support_lib_version_oserror_fallback():
    """_load_support_lib_version falls back to '^2.0.0' when file is unreadable."""
    # pylint: disable-next=import-outside-toplevel
    from rpdk.typescript.codegen import _load_support_lib_version

    with patch("builtins.open", side_effect=OSError("no such file")):
        with patch("rpdk.typescript.codegen.LOG") as mock_log:
            version = _load_support_lib_version()

    assert version == "^2.0.0"
    mock_log.warning.assert_called_once()


def test_generate_with_configuration_schema(project: Project):
    """generate() resolves TypeConfigurationModel from project.configuration_schema."""
    project.load_schema()
    # Inject a minimal configuration_schema so the `if project.configuration_schema:`
    # branch (codegen.py:217) is taken.
    project.configuration_schema = {
        "properties": {"Endpoint": {"type": "string"}},
        "additionalProperties": False,
    }
    project.generate()
    models_ts = (project.root / "src" / "models.ts").read_text()
    # The generated file must declare a TypeConfigurationModel with the Endpoint field.
    assert "TypeConfigurationModel" in models_ts
    assert "Endpoint" in models_ts


def test_recursive_relative_write_skips_directories(tmp_path):
    """_recursive_relative_write skips directory entries."""
    from io import BytesIO  # pylint: disable=import-outside-toplevel
    from zipfile import ZipFile  # pylint: disable=import-outside-toplevel,reimported

    # Create a source tree: src_path/subdir/ and src_path/file.txt
    src_path = tmp_path / "src"
    src_path.mkdir()
    sub_dir = src_path / "subdir"
    sub_dir.mkdir()
    (src_path / "file.txt").write_text("hello")

    buf = BytesIO()
    with ZipFile(buf, "w") as zf:
        TypescriptLanguagePlugin._recursive_relative_write(src_path, tmp_path, zf)
        names = zf.namelist()

    # Directories should not appear — only the file
    assert any("file.txt" in n for n in names)
    assert not any(n.endswith("/") for n in names)


def test_make_build_command_default():
    """_make_build_command without build_command returns default npm+sam command."""
    cmd = TypescriptLanguagePlugin._make_build_command("/base", build_command=None)
    assert "npm install" in cmd
    assert "sam build" in cmd


def test_validate_prerequisites_node_called_process_error(
    plugin: TypescriptLanguagePlugin,
):
    """DownstreamError raised when `node --version` subprocess call fails."""

    def which_side_effect(cmd):
        return f"/usr/bin/{cmd}" if cmd in ("npm", "node") else None

    with patch("rpdk.typescript.codegen.shutil.which", side_effect=which_side_effect):
        with patch(
            "rpdk.typescript.codegen.subprocess_run",
            side_effect=CalledProcessError(1, "node"),
        ):
            with pytest.raises(
                DownstreamError, match="Failed to determine Node.js version"
            ):
                plugin._validate_build_prerequisites()


def test_validate_prerequisites_node_version_unparseable(
    plugin: TypescriptLanguagePlugin,
):
    """Unparseable node version string is warned about but does not raise."""

    def which_side_effect(cmd):
        return f"/usr/bin/{cmd}" if cmd in ("npm", "node", "sam") else None

    with patch("rpdk.typescript.codegen.shutil.which", side_effect=which_side_effect):
        with patch(
            "rpdk.typescript.codegen.subprocess_run",
            return_value=type(
                "CP", (), {"stdout": "not-a-version\n", "returncode": 0}
            )(),
        ):
            with patch("rpdk.typescript.codegen.LOG") as mock_log:
                plugin._validate_build_prerequisites()  # should not raise

    mock_log.warning.assert_called_once()
