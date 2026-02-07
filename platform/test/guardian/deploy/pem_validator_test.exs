defmodule Guardian.Deploy.PemValidatorTest do
  use ExUnit.Case, async: true

  alias Guardian.Deploy.PemValidator

  describe "validate/1" do
    test "passes with valid escaped-newline format" do
      content =
        "GITHUB_APP_PRIVATE_KEY=-----BEGIN RSA PRIVATE KEY-----\\nMIIE...\\n-----END RSA PRIVATE KEY-----"

      assert PemValidator.validate(content) == []
    end

    test "fails with quoted value" do
      content = "GITHUB_APP_PRIVATE_KEY=\"-----BEGIN RSA PRIVATE KEY-----\\nMIIE...\""
      errors = PemValidator.validate(content)
      assert Enum.any?(errors, &String.contains?(&1, "must not be quoted"))
    end

    test "fails with missing literal \\n" do
      content = "GITHUB_APP_PRIVATE_KEY=-----BEGIN RSA PRIVATE KEY-----"
      errors = PemValidator.validate(content)
      assert Enum.any?(errors, &String.contains?(&1, "missing literal \\n"))
    end

    test "fails with duplicate key lines" do
      content =
        "GITHUB_APP_PRIVATE_KEY=-----BEGIN RSA PRIVATE KEY-----\\nfoo\nGITHUB_APP_PRIVATE_KEY=-----BEGIN RSA PRIVATE KEY-----\\nbar"

      errors = PemValidator.validate(content)
      assert Enum.any?(errors, &String.contains?(&1, "Multiple"))
    end

    test "passes when key is not present" do
      content = "OTHER_VAR=hello\nANOTHER=world"
      assert PemValidator.validate(content) == []
    end
  end
end
