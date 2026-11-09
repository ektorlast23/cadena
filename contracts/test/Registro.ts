import { expect } from "chai";
import { network } from "hardhat";

const { ethers, networkHelpers } = await network.create();
const { loadFixture } = networkHelpers;

async function deployFixture() {
  const [owner, otro] = await ethers.getSigners();
  const registro = await ethers.deployContract("Registro", [owner.address]);
  return { registro, owner, otro };
}

describe("Registro", function () {
  it("registra un documento y emite el evento", async function () {
    const { registro, owner } = await loadFixture(deployFixture);
    const hash = ethers.id("documento-1");

    await expect(registro.registrar(hash, "ipfs://documento-1"))
      .to.emit(registro, "DocumentoRegistrado")
      .withArgs(hash, owner.address, "ipfs://documento-1");

    const documento = await registro.obtener(hash);
    expect(documento.hash).to.equal(hash);
    expect(documento.registrador).to.equal(owner.address);
    expect(documento.uri).to.equal("ipfs://documento-1");
    expect(documento.activo).to.equal(true);
    expect(await registro.total()).to.equal(1n);
    expect(await registro.existe(hash)).to.equal(true);
  });

  it("rechaza el hash cero", async function () {
    const { registro } = await loadFixture(deployFixture);
    const hash = ethers.ZeroHash;

    await expect(registro.registrar(hash, "ipfs://cero")).to.be.revertedWithCustomError(
      registro,
      "HashInvalido",
    );
  });

  it("rechaza documentos duplicados", async function () {
    const { registro } = await loadFixture(deployFixture);
    const hash = ethers.id("documento-duplicado");

    await registro.registrar(hash, "ipfs://uno");

    await expect(registro.registrar(hash, "ipfs://dos"))
      .to.be.revertedWithCustomError(registro, "DocumentoYaRegistrado")
      .withArgs(hash);
  });

  it("solo permite registrar al owner", async function () {
    const { registro, otro } = await loadFixture(deployFixture);
    const hash = ethers.id("documento-no-autorizado");

    const registroComoOtro = registro.connect(otro) as typeof registro;

    await expect(registroComoOtro.registrar(hash, "ipfs://x"))
      .to.be.revertedWithCustomError(registro, "OwnableUnauthorizedAccount")
      .withArgs(otro.address);
  });

  it("revoca un documento registrado", async function () {
    const { registro, owner } = await loadFixture(deployFixture);
    const hash = ethers.id("documento-revocado");
    await registro.registrar(hash, "ipfs://revocable");

    await expect(registro.revocar(hash))
      .to.emit(registro, "DocumentoRevocado")
      .withArgs(hash, owner.address);

    expect((await registro.obtener(hash)).activo).to.equal(false);
    await expect(registro.revocar(hash))
      .to.be.revertedWithCustomError(registro, "DocumentoYaRevocado")
      .withArgs(hash);
  });

  it("falla al consultar un documento inexistente", async function () {
    const { registro } = await loadFixture(deployFixture);
    const hash = ethers.id("no-existe");

    await expect(registro.obtener(hash))
      .to.be.revertedWithCustomError(registro, "DocumentoNoEncontrado")
      .withArgs(hash);
    expect(await registro.existe(hash)).to.equal(false);
  });
});
